import { PassThrough } from 'stream';

import _ from 'lodash';
import AWS from 'aws-sdk';
import Promise from 'bluebird';
import Boom from 'boom';
import Joi from 'joi';
import path from 'path';

import pkg from '../package.json';

const routeOptionsSchema = Joi.object().keys({
  // specifies whether to include the Content-Disposition header
  mode: Joi.valid(false, 'attachment', 'inline'),

  // if provided, the function will be passed the request and a callback of the
  // form `function(err, filename)`. `filename` will then be added to the
  // Content-Disposition header
  filename: Joi.alternatives().when('mode', {
    is: false,
    then: Joi.forbidden(),
    otherwise: Joi.func().optional(),
  }),

  // if S3's reported content-type is key, replace it with value
  // example: { "application/octet-stream" : "application/pdf" }
  overrideContentTypes: Joi.object().optional().default({}),

  // bucket to serve files from
  bucket: Joi.string().required(),

  // bucket's region (defaults to us-standard/us-east-1)
  region: Joi.string().optional().default('us-east-1'),

  // if a string is provided, then it will be used to look up the key
  //   - if the route contains a parameter called "path", the key will be treated as a prefix
  //   - otherwise, the key will be treated as a literal S3 key
  // if a function is provided, it will be passed the request and a callback of the
  //   form `function(err, key)`.
  key: Joi.alternatives().try(
    Joi.string(),
    Joi.func()
  ).optional(),

  // use SSL when communicating with S3 (default true)
  sslEnabled: Joi.boolean().default(true),

  // key id and secret key (defaults to environment)
  accessKeyId: Joi.string().optional().default(process.env.AWS_ACCESS_KEY_ID),
  secretAccessKey: Joi.string().optional().default(process.env.AWS_SECRET_ACCESS_KEY),
}).options({
  allowUnknown: false,
});

function getObjectStream(request, key) {
  const routeOptions = request.route.settings.plugins.s3;

  const s3 = new AWS.S3({
    params: {
      Bucket: routeOptions.bucket,
    },
    accessKeyId: routeOptions.accessKeyId,
    secretAccessKey: routeOptions.secretAccessKey,
    region: routeOptions.region,
    sslEnabled: routeOptions.sslEnabled,
  });

  return new Promise((resolve, reject) => {
    const req = s3.getObject({ Key: key });
    const passthrough = new PassThrough();

    req.on('error', (err) => {
      reject(err);
    });

    req.on('httpData', (chunk) => {
      passthrough.write(chunk);
    });

    req.on('httpDone', () => {
      passthrough.end();
    });

    req.on('httpHeaders', (statusCode, headers) => {
      if (statusCode >= 400) {
        reject(Boom.create(statusCode));
        return;
      }

      resolve({
        headers,
        stream: passthrough,
      });
    });

    req.send();
  });
}

function getKey(request) {
  const opts = request.route.settings.plugins.s3;

  return new Promise((resolve, reject) => {
    if (_.isString(opts.key) || !opts.key) {
      if (request.params.path) {
        return resolve(path.join(opts.key, request.params.path));
      }

      return resolve(opts.key);
    }

    return opts.key(request, (err, key) => {
      if (err instanceof Error) {
        return reject(err);
      }

      if (!key) {
        return reject(new Error('Empty S3 key'));
      }

      return resolve(key);
    });
  });
}

function getFilename(request) {
  const opts = request.route.settings.plugins.s3;

  return new Promise((resolve, reject) => {
    if (!opts.filename) {
      return resolve();
    }

    return opts.filename(request, (err, filename) => {
      if (err instanceof Error) {
        return reject(err);
      }

      return resolve(filename);
    });
  });
}

function getContentType(request, s3ContentType) {
  const routeOptions = request.route.settings.plugins.s3;

  if (s3ContentType && routeOptions.overrideContentTypes[s3ContentType]) {
    return routeOptions.overrideContentTypes[s3ContentType];
  }

  return s3ContentType;
}

function getContentDisposition(request, filename) {
  const routeOptions = request.route.settings.plugins.s3;

  if (!routeOptions.mode) {
    return null;
  }

  let disposition = routeOptions.mode;
  if (filename) {
    disposition = `${disposition}; filename=${filename}`;
  }

  return disposition;
}

function handler(request, reply) {
  Promise.join(
    getKey(request),
    getFilename(request),
    (key, filename) => getObjectStream(request, key)
        .then((data) => {
          const response = reply(data.stream);

          const contentType = getContentType(request, data.headers['content-type']);
          if (contentType) {
            response.header('Content-Type', contentType);
          }

          const disposition = getContentDisposition(request, filename);
          if (disposition) {
            response.header('Content-Disposition', disposition);
          }
        })
  )
    .catch((err) => reply(err));
}

function register(server, options, next) {
  function s3Handler(route, routeOptions) {
    if (route.method !== 'get') {
      throw new Error('s3 handler currently only supports GET');
    }

    const valid = Joi.validate(routeOptions, routeOptionsSchema);
    if (valid.error) {
      throw valid.error;
    }

    route.settings.plugins.s3 = valid.value; // eslint-disable-line no-param-reassign

    return handler;
  }

  s3Handler.defaults = {
    payload: {
      output: 'stream',
      parse: false,
    },
  };

  server.handler('s3', s3Handler);

  next();
}

register.attributes = {
  name: pkg.name,
  version: pkg.version,
  multiple: false,
};

export default register;

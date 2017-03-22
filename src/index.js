import { PassThrough } from 'stream';

import AWS from 'aws-sdk';
import Boom from 'boom';
import Joi from 'joi';
import path from 'path';

import pkg from '../package.json';

const routeOptionsSchema = Joi.object().keys({
  // Specifies whether to include the Content-Disposition header.
  mode: Joi.valid(false, 'attachment', 'inline').default(false),

  // If provided, the function will receive the request and it should return a promise
  // that resolves the mapped `filename`. `filename` will then be added to the
  // Content-Disposition header. If mode is not false but no function is given `filename`
  // will be set to the key's filename
  filename: Joi.alternatives().when('mode', {
    is: false,
    then: Joi.forbidden(),
    otherwise: Joi.func().optional(),
  }),

  // If S3's reported content-type is key, replace it with value
  // example: { "application/octet-stream" : "application/pdf" }
  overrideContentTypes: Joi.object().optional().default({}),

  // bucket's region (defaults to us-standard/us-east-1)
  region: Joi.string().optional().default('us-east-1'),

  // If a string is provided it will be used as bucket name.
  // If a function is proviced, it will receive the request and should return a promise
  // that resolves the mapped `bucket`.
  bucket: Joi.alternatives().try(
    Joi.string(),
    Joi.func()
  ).required(),

  // If a string is provided, then it will be used to look up the key:
  //   - if the route contains a parameter called "path", the key will be treated as a prefix
  //   - otherwise, the key will be treated as a literal S3 key
  // If a function is provided, it will receive the request and it should return a promise
  // that resolves the mapped `key`.
  key: Joi.alternatives().try(
    Joi.string(),
    Joi.func()
  ).optional(),

  // use SSL when communicating with S3 (default true)
  sslEnabled: Joi.boolean().default(true),

  // key id and secret key (defaults to environment)
  accessKeyId: Joi.string().optional().default(process.env.AWS_ACCESS_KEY_ID),
  secretAccessKey: Joi.string().optional().default(process.env.AWS_SECRET_ACCESS_KEY),

  // additional aws s3 options
  s3Params: Joi.object().optional().default({}),
}).options({
  allowUnknown: false,
});

function getObjectStream(request, bucket, key) {
  if (!bucket || !key) {
    return Promise.reject('bucket or key should not be empty');
  }

  const routeOptions = request.route.settings.plugins.s3;

  const s3 = new AWS.S3({
    accessKeyId: routeOptions.accessKeyId,
    secretAccessKey: routeOptions.secretAccessKey,
    region: routeOptions.region,
    sslEnabled: routeOptions.sslEnabled,
    ...routeOptions.s3Params,
  });

  return new Promise((resolve, reject) => {
    const req = s3.getObject({ Bucket: bucket, Key: key });
    const passthrough = new PassThrough();

    req.on('error', (err) => reject(err));
    req.on('httpData', (chunk) => passthrough.write(chunk));
    req.on('httpDone', () => passthrough.end());

    req.on('httpHeaders', (statusCode, headers) => {
      if (statusCode >= 400) {
        return reject(Boom.create(statusCode));
      }

      return resolve({
        headers,
        stream: passthrough,
      });
    });

    req.send();
  });
}

function getBucket(request) {
  const { bucket } = request.route.settings.plugins.s3;

  if (typeof bucket === 'string') {
    return Promise.resolve(bucket);
  }

  return Promise.resolve(bucket(request));
}

function getKey(request) {
  const { key } = request.route.settings.plugins.s3;

  if (typeof key === 'string') {
    if (request.params.path) {
      return Promise.resolve(path.join(key, request.params.path));
    }

    return Promise.resolve(key);
  }

  if (!key) {
    if (request.params.path) {
      return Promise.resolve(request.params.path);
    } else {
      return Promise.resolve('');
    }
  }

  return Promise.resolve(key(request));
}

function getFilename(request, key) {
  const { filename } = request.route.settings.plugins.s3;
  if (!filename) {
    return Promise.resolve(path.basename(key));
  }

  return Promise.resolve(filename(request));
}

function getContentType(request, s3ContentType) {
  const { overrideContentTypes } = request.route.settings.plugins.s3;

  if (s3ContentType && overrideContentTypes[s3ContentType]) {
    return overrideContentTypes[s3ContentType];
  }

  return s3ContentType;
}

function getContentDisposition(request, filename) {
  const { mode } = request.route.settings.plugins.s3;

  if (!mode) {
    return null;
  }

  let disposition = mode;
  if (filename) {
    disposition = `${disposition}; filename=${filename}`;
  }

  return disposition;
}

function handler(request, reply) {
  return Promise.all([getBucket(request), getKey(request)])
    .then(([bucket, key]) => { // eslint-disable-line arrow-body-style
      return getFilename(request, key)
        .then((filename) => [bucket, key, filename]);
    })
    .then(([bucket, key, filename]) => { // eslint-disable-line arrow-body-style
      return getObjectStream(request, bucket, key)
        .then((data) => {
          const response = reply(data.stream);

          const contentType = getContentType(request, data.headers['content-type']);
          if (contentType) {
            response.type(contentType);
          }

          const disposition = getContentDisposition(request, filename);
          if (disposition) {
            response.header('Content-Disposition', disposition);
          }
        });
    })
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

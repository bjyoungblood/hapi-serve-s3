const Path = require('path');
const { PassThrough } = require('stream');

const AWS = require('aws-sdk');
const Boom = require('boom');
const Joi = require('joi');
const ContentDisposition = require('content-disposition');

const Pkg = require('../package.json');

const internals = {};


internals.routeOptionsSchema = Joi.object()
  .keys({
    // Specifies whether to include the Content-Disposition header.
    mode: Joi.valid(false, 'attachment', 'inline', 's3').default(false),

    // If provided, the function will receive the request and it should return a promise
    // that resolves the mapped `filename`. `filename` will then be added to the
    // Content-Disposition header. If mode is not false but no function is given `filename`
    // will be set to the key's filename
    filename: Joi.alternatives().when('mode', {
      is: Joi.valid(false, 's3'),
      then: Joi.forbidden(),
      otherwise: Joi.func().optional(),
    }),

    // If S3's reported content-type is key, replace it with value
    // example: { "application/octet-stream" : "application/pdf" }
    overrideContentTypes: Joi.object().optional().default({}),

    // bucket's region (defaults to us-standard/us-east-1)
    region: Joi.string().optional().default('us-east-1'),

    // If a string is provided it will be used as bucket name.
    // If a function is provided, it will receive the request and should return a promise
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
  })
  .options({
    allowUnknown: false,
  });


/**
 * returns a S3 client using the `request.route` configuration
 */
internals.getS3Client = function (request) {

  const routeOptions = request.route.settings.plugins.s3;

  return new AWS.S3({
    accessKeyId: routeOptions.accessKeyId,
    secretAccessKey: routeOptions.secretAccessKey,
    region: routeOptions.region,
    sslEnabled: routeOptions.sslEnabled,
    ...routeOptions.s3Params,
  });
};


/**
 * resolves with a stream of the S3 Object
 */
internals.getObjectStream = function (request, bucket, key) {

  if (!bucket || !key) {
    return Promise.reject('bucket or key should not be empty');
  }

  const s3 = internals.getS3Client(request);

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
};


/**
 * resolves with the S3 `Bucket`
 */
internals.getBucket = function (request) {
  const { bucket } = request.route.settings.plugins.s3;

  if (typeof bucket === 'string') {
    return Promise.resolve(bucket);
  }

  return Promise.resolve(bucket(request));
};


/**
 * resolves with the S3 `Key`
 */
internals.getKey = function (request) {

  const { key } = request.route.settings.plugins.s3;

  if (typeof key === 'string') {
    if (request.params.path) {
      return Promise.resolve(Path.join(key, request.params.path));
    }

    return Promise.resolve(key);
  }

  if (!key) {
    if (request.params.path) {
      return Promise.resolve(request.params.path);
    }

    return Promise.resolve('');
  }

  return Promise.resolve(key(request));
};


/**
 * resolves with a transformed version of the S3 Object's meta
 */
internals.getObjectMetaData = function (request, bucket, key) {

  const { mode } = request.route.settings.plugins.s3;

  if (mode !== 's3') {
    return Promise.resolve();
  }

  const s3 = internals.getS3Client(request);
  return new Promise((resolve, reject) => {

    s3.headObject({ Bucket: bucket, Key: key }, (err, data) => {

      if (err) {
        return reject(err);
      }

      // only return this meta data that is necessary
      let dispositionFilename = null;
      let dispositionType = null;

      if (data.ContentDisposition) {
        const disposition = ContentDisposition.parse(data.ContentDisposition);
        dispositionType = disposition.type;

        if (disposition.parameters) {
          dispositionFilename = disposition.parameters.filename;
        }
      }

      return resolve({
        dispositionType,
        dispositionFilename
      });
    });
  });
};

/**
 * resolves the `filename` for the Content-Disposition header
 */
internals.getFilename = function (request, bucket, key, objectMetaData) {

  const { mode, filename } = request.route.settings.plugins.s3;

  // in s3 mode we try to use the filename of the S3 Object's meta data Content-Disposition
  if (mode === 's3') {
    if (!objectMetaData.dispositionFilename) {
      return Promise.resolve(Path.basename(key));
    }

    return Promise.resolve(objectMetaData.dispositionFilename);
  }

  if (!filename) {
    return Promise.resolve(Path.basename(key));
  }

  return Promise.resolve(filename(request));
};


/**
 * returns the type for the Content-Type Header
 */
internals.getContentType = function (request, s3ContentType) {

  const { overrideContentTypes } = request.route.settings.plugins.s3;

  if (s3ContentType && overrideContentTypes[s3ContentType]) {
    return overrideContentTypes[s3ContentType];
  }

  return s3ContentType;
};


/**
 * returns the disposition for the Content-Disposition Header
 */
internals.getContentDisposition = function (request, filename, objectMetaData) {

  const { mode } = request.route.settings.plugins.s3;

  if (!mode) {
    return null;
  }

  let type;
  let name = undefined;

  if (mode === 's3') {
    type = objectMetaData.dispositionType;
  } else {
    type = mode;
  }

  if (filename) {
    name = filename;
  }

  return ContentDisposition(name, { type });
};


/**
 * s3 request-handler definition
 */
internals.handler = function (request, reply) {

  return Promise
    .all([
      internals.getBucket(request),
      internals.getKey(request)
    ])
    .then(([bucket, key]) => {

      return internals.getObjectMetaData(request, bucket, key)
        .then((objectMetaData) => [bucket, key, objectMetaData]);
    })
    .then(([bucket, key, objectMetaData]) => {

      return internals.getFilename(request, bucket, key, objectMetaData)
        .then((filename) => [bucket, key, filename, objectMetaData]);
    })
    .then(([bucket, key, filename, objectMetaData]) => {

      return internals.getObjectStream(request, bucket, key)
        .then((data) => {

          const response = reply(data.stream);

          const contentType = internals.getContentType(request, data.headers['content-type']);
          if (contentType) {
            response.type(contentType);
          }

          const disposition = internals.getContentDisposition(request, filename, objectMetaData);
          if (disposition) {
            response.header('Content-Disposition', disposition);
          }
        });
    })
    .catch(reply);
};


/**
 * s3 meta-handler defintion
 */
internals.s3Handler = function (route, routeOptions) {

  if (route.method !== 'get') {
    throw new Error('s3 handler currently only supports GET');
  }

  const valid = Joi.validate(routeOptions, internals.routeOptionsSchema);
  if (valid.error) {
    throw valid.error;
  }

  route.settings.plugins.s3 = valid.value; // eslint-disable-line no-param-reassign

  return internals.handler;
};


internals.s3Handler.defaults = {
  payload: {
    output: 'stream',
    parse: false,
  },
};


/**
 * plugin definition
 */
const register = module.exports = function (server, options, next) {

  server.handler('s3', internals.s3Handler);
  next();
};


register.attributes = {
  name: Pkg.name,
  version: Pkg.version,
  multiple: false,
};

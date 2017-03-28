/**
 * Handler for serving files from S3
 */

const { PassThrough } = require('stream');

const Boom = require('boom');

const Helpers = require('./helpers');

const internals = {};
const Serve = exports;


/**
 * resolves with a stream of the S3 Object
 */
internals.getObjectStream = function (request, bucket, key, params = {}) {

  if (!bucket || !key) {
    return Promise.reject(Helpers.BadImplementationError('bucket or key should not be empty'));
  }

  const s3 = Helpers.getS3Client(request);

  const getParams = Object.assign({}, params, {
    Bucket: bucket,
    Key: key
  });

  return new Promise((resolve, reject) => {
    const req = s3.getObject(getParams);
    const passthrough = new PassThrough();

    req.on('error', (err) => reject(Helpers.S3Error(err, { bucket, key })));
    req.on('httpData', (chunk) => passthrough.write(chunk));
    req.on('httpDone', () => passthrough.end());

    req.on('httpHeaders', (statusCode, headers) => {
      if (statusCode >= 400) {
        return reject(Boom.create(statusCode));
      }

      return resolve({
        headers,
        stream: passthrough
      });
    });

    req.send();
  });
};


/**
 * s3 request-handler definition
 */
Serve.handler = function (request, reply) {

  // resolve `bucket` and `key`
  const getBucketAndKey = function () {
    return Promise
      .all([
        Helpers.getBucket(request),
        Helpers.getKey(request)
      ]);
  };

  // load s3 object meta data if necessary
  const getObjectMetaData = function ([bucket, key]) {
    return Helpers.getObjectMetaData(request, bucket, key)
      .then((objectMetaData) => [bucket, key, objectMetaData]);
  };

  // resolve `filename` for the content disposition header
  const getContentDispositionAndType = function ([bucket, key, objectMetaData]) {
    return Promise
      .all([
        Helpers.getContentType(request, bucket, key, objectMetaData),
        Helpers.getContentDisposition(request, bucket, key, objectMetaData)
      ])
      .then(([type, disposition]) => [bucket, key, type, disposition]);
  };

  // get the s3 object stream
  const getObjectStream = function ([bucket, key, type, disposition]) {
    return internals.getObjectStream(request, bucket, key)
      .then((data) => [bucket, key, data, type, disposition]);
  };

  // reply with the s3 stream + add content type and content disposition
  // accordingly or delegate reply behaviour to `onResponse`
  const replyWithStream = function ([bucket, key, data, type, disposition]) {
    const { onResponse } = request.route.settings.plugins.s3;

    // delegate reply if configured
    if (onResponse) {
      const options = {
        bucket,
        key,
        contentType: type,
        contentDisposition: disposition
      };

      return onResponse(/* error */null, /* res */data.stream, request, reply, options);
    }

    // default reply strategy
    const response = reply(data.stream);

    if (type) {
      response.type(type);
    }

    if (disposition) {
      response.header('Content-Disposition', disposition);
    }

    return response;
  };

  const replyWithError = function (err) {
    const { onResponse } = request.route.settings.plugins.s3;
    const error = Boom.wrap(err);

    // delegate reply if configured
    if (onResponse) {
      return onResponse(error, null, request, reply);
    }

    // default reply strategy
    return reply(error);
  };

  return Promise.resolve()
    .then(getBucketAndKey)
    .then(getObjectMetaData)
    .then(getContentDispositionAndType)
    .then(getObjectStream)
    .then(replyWithStream)
    .catch(replyWithError);
};


Serve.handler.defaults = {
  payload: {
    output: 'stream',
    parse: false
  }
};

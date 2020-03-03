/**
 * Handler for serving files from S3
 */

const Boom = require('boom');
const Content = require('content');
const Hoek = require('hoek');

const Helpers = require('./helpers');

const internals = {};
const Upload = exports;


/**
 * Try to resolve the filekey from the given FormData File.
 *
 * - try to use the content-disposition `filename`, or ...
 * - try to use the content-disposition `name`, or ...
 * - use the FormData key itself
 */
internals.getFileKey = function (file) {

  let fileKey = file.key;

  const headers = Hoek.reach(file.payload, 'hapi.headers', { default: {} });
  if (headers['content-disposition']) {
    const parsed = Content.disposition(headers['content-disposition']);

    if (parsed.filename) {
      fileKey = parsed.filename;
    } else if (parsed.name) {
      fileKey = parsed.name;
    }
  }

  return fileKey;
};


/**
 * uploads the given file and resolves with the S3 response data
 */
internals.uploadStream = function (request, bucket, key, file, params = {}) {

  if (!bucket || !key) {
    return Promise.reject(Helpers.BadImplementationError('bucket or key should not be empty'));
  }

  const s3 = Helpers.getS3Client(request);

  const uploadParams = Object.assign({}, params, {
    Bucket: bucket,
    Key: key,
    Body: file
  });

  return new Promise((resolve, reject) => {
    s3.upload(uploadParams, (err, data) => {

      if (err) {
        return reject(Helpers.S3Error(err, { bucket, key }));
      }

      return resolve(data);
    });
  });
};


/**
 * s3 request-handler definition
 */
Upload.handler = function (request, reply) {

  const getFiles = function () {
    const { payload } = request;

    if (!payload) {
      return [];
    }

    return Object.keys(payload)
      .map((key) => ({ key, payload: payload[key] }));
  };

  // resolve `bucket` and `key`
  const getBucketAndKey = function (file) {
    const { randomPostKeys: randomize } = request.route.settings.plugins.s3;
    const fileKey = internals.getFileKey(file);

    return Promise
      .all([
        Helpers.getBucket(request),
        Helpers.getKey(request, { formDataKey: file.key, fileKey, randomize })
      ])
      .then(([bucket, key]) => [file, bucket, key]);
  };

  // load s3 object meta data, to ensure the file does not yet exist
  const assertObjectDoesNotExist = function ([file, bucket, key]) {
    return Helpers.getObjectMetaData(request, bucket, key)
      // the file exists
      .then(() => Promise.reject(Boom.conflict(`the file s3://${bucket}/${key} does already exist`)))
      .catch((err) => {
        // only catch wrapped 404 errors
        if (err.isBoom && err.output.statusCode === 404) {
          return [file, bucket, key];
        }

        return Promise.reject(err);
      });
  };

  // resolve `filename` for the content disposition header
  const getContentDispositionAndType = function ([file, bucket, key]) {
    const headers = Hoek.reach(file.payload, 'hapi.headers', { default: {} });

    return Promise
      .all([
        Helpers.getContentType(request, bucket, key, { ContentType: headers['content-type'] }),
        Helpers.getContentDisposition(request, bucket, key, { ContentDisposition: headers['content-disposition'] })
      ])
      .then(([type, disposition]) => [file, bucket, key, type, disposition]);
  };

  // validate given file
  const assertUploadIsValid = function ([file, bucket, key, type, disposition]) {
    const {
      headers,
      route: {
        settings: {
          plugins: {
            s3: {
              allowedContentTypes,
              ignoredFormKeys
            }
          }
        }
      }
    } = request;

    const { key: fileKey } = file;

    // check for proper multipart files
    if (!headers['content-type']) {
      return Promise.reject(Boom.badData('missing content-type header'));
    }

    const contentType = Content.type(headers['content-type']);

    if (contentType.mime !== 'multipart/form-data') {
      const msg = `request must be a "multipart/form-data" but found "${contentType.mime}"`;
      return Promise.reject(Boom.unsupportedMediaType(msg));
    }

    // check if content type is allowed, if necessary
    if (allowedContentTypes && !Helpers.hasMatch(allowedContentTypes, type)) {
      const msg = `for upload "${fileKey}" "content-type" is not allowed to be: [${type}]`;
      return Promise.reject(Boom.unsupportedMediaType(msg));
    }

    // skip form data entries that are blacklisted
    if (Helpers.hasMatch(ignoredFormKeys, fileKey)) {
      return null;
    }

    return [file, bucket, key, type, disposition];
  };

  // get the s3 object stream
  const uploadStream = function ([file, bucket, key, type, disposition]) {
    const uploadParams = {};

    if (type) {
      uploadParams.ContentType = type;
    }

    if (disposition) {
      uploadParams.ContentDisposition = disposition;
    }

    return internals.uploadStream(request, bucket, key, file.payload, uploadParams)
      .then((data) => [file, bucket, key, data, type, disposition]);
  };

  // iterate through all files and prepare and validate them
  const prepareFiles = function (files) {
    return Promise
      .all(files.map((file) => {
        return Promise.resolve(file)
          .then(getBucketAndKey)
          .then(assertObjectDoesNotExist)
          .then(getContentDispositionAndType)
          .then(assertUploadIsValid);
      }))
      // filter empty results
      .then((files) => files.filter(Helpers.exists));
  };

  // upload valid file
  const uploadFiles = function (files) {
    return Promise.all(files.map((file) => {
      return Promise.resolve(file)
        .then(uploadStream);
    }));
  };

  // reply with the meta data of the S3 Upload or delegate reply behaviour
  // to `onResponse`
  const replyCreated = function (uploads) {
    const { onResponse } = request.route.settings.plugins.s3;

    const payload = uploads.reduce((memo, [file, bucket, key, data, type, disposition]) => { // eslint-disable-line no-unused-vars

      memo[file.key] = Helpers.compactObject(Object.assign({}, data, {
        ContentType: type,
        ContentDisposition: disposition
      }));

      return memo;
    }, {});

    // delegate reply if configured
    if (onResponse) {
      const options = {
        uploads: uploads.map(([file, bucket, key, data, type, disposition]) => Helpers.compactObject({ // eslint-disable-line no-unused-vars
          file: file.key,
          bucket,
          key,
          contentType: type,
          contentDisposition: disposition,
          data: payload[file.key]
        })),
        defaultStatusCode: 201
      };

      return onResponse(null, /* res */payload, request, reply, options);
    }

    // default reply strategy
    return reply(payload).code(201);
  };

  return Promise.resolve()
    .then(getFiles)
    .then(prepareFiles)
    .then(uploadFiles)
    .then(replyCreated)
    .catch(Helpers.replyWithError(request, reply));
};


Upload.handler.defaults = {
  payload: {
    output: 'stream',
    parse: true,
    maxBytes: 1024 * 1024 * 10 // 10MB
  }
};

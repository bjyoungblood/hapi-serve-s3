/**
 * Handler for serving files from S3
 */

const Helpers = require('./helpers');

const internals = {};
const Delete = exports;


/**
 * deletes an object from s3
 */
internals.deleteObject = function (request, bucket, key, params = {}) {

  if (!bucket || !key) {
    return Promise.reject(Helpers.BadImplementationError('bucket or key should not be empty'));
  }

  const s3 = Helpers.getS3Client(request);

  const deleteParams = Object.assign({}, params, {
    Bucket: bucket,
    Key: key
  });

  return new Promise((resolve, reject) => {

    s3.deleteObject(deleteParams, (err, data) => {

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
Delete.handler = function (request, reply) {

  // resolve `bucket` and `key`
  const getBucketAndKey = function () {
    return Promise
      .all([
        Helpers.getBucket(request),
        Helpers.getKey(request)
      ])
      .then(([bucket, key]) => [bucket, key]);
  };

  // delete the s3 object
  const deleteObject = function ([bucket, key]) {
    return internals.deleteObject(request, bucket, key)
      .then((data) => [bucket, key, data]);
  };

  // reply with the meta data of the S3 Upload or delegate reply behaviour
  // to `onResponse`
  const replyDeleted = function ([bucket, key, data]) {
    const { onResponse } = request.route.settings.plugins.s3;

    // delegate reply if configured
    if (onResponse) {
      const options = {
        bucket,
        key,
        defaultStatusCode: 204,
        s3Response: data
      };

      return onResponse(null, /* res */null, request, reply, options);
    }

    // default reply strategy
    return reply().code(204);
  };

  return Promise.resolve()
    .then(getBucketAndKey)
    .then(deleteObject)
    .then(replyDeleted)
    .catch(Helpers.replyWithError(request, reply));
};


Delete.handler.defaults = {};

const Path = require('path');

const AWS = require('aws-sdk');
const Boom = require('boom');
const ContentDisposition = require('content-disposition');
const Hoek = require('hoek');
const Uuid = require('uuid');

const Helpers = exports;
const internals = {};


/**
 * test if the given value is a truthy value
 *
 * @param {Any} item
 * @return {Boolean}
 */
Helpers.exists = function (item) {

  return Boolean(item);
};


/**
 * Create a shallow copy of the given `source` without keys
 * that match `null` or `undefined`
 *
 * @param {Object} source
 * @return {Object} shallow copy without `null` and `undefined` values
 */
Helpers.compactObject = function (source) {
  return Object.keys(source).reduce((memo, key) => {
    const value = source[key];

    if (![null, undefined].includes(value)) {
      memo[key] = value;
    }

    return memo;
  }, {});
};


/**
 * Create a shallow copy of `source` but with `omitted` keys not being part
 * of it.
 *
 * @param {Object} source
 * @param {Array<Key>} omitted - list of omitted keys
 * @return {Object} shallow copy without omitted keys
 */
Helpers.omit = function (source, omitted) {
  return Object.keys(source).reduce((memo, key) => {
    const value = source[key];

    if (!omitted.includes(key)) {
      memo[key] = value;
    }

    return memo;
  }, {});
};


/**
 * return an "Internal Server Error" Error with the given `message` set
 *
 * @param {String} message
 * @param {Object} [data]
 * @return {BoomError}
 */
Helpers.BadImplementationError = function (message, data) {
  const err = Boom.badImplementation(message, data);
  err.output.payload.message = message;

  return err;
};


/**
 * returns a S3 client using the `request.route` configuration
 *
 * @params {Object} request - hapi request object
 * @returns {S3Client}
 */
Helpers.getS3Client = function (request) {

  const routeOptions = request.route.settings.plugins.s3;

  return new AWS.S3(Object.assign(
    {},
    {
      accessKeyId: routeOptions.accessKeyId,
      secretAccessKey: routeOptions.secretAccessKey,
      region: routeOptions.region,
      sslEnabled: routeOptions.sslEnabled
    },
    routeOptions.s3Params
  ));
};


/**
 * resolves with the S3 `Bucket`
 *
 * @param {Object} request - Hapi request Object
 * @resolve {String} - resolved S3 Bucket name
 * @reject - if no bucket could be resolved
 */
Helpers.getBucket = function (request) {

  const { bucket } = request.route.settings.plugins.s3;

  if (typeof bucket === 'string') {
    return Promise.resolve(bucket);
  }

  if (typeof bucket === 'function') {
    return Promise.resolve(bucket(request));
  }

  return Promise.reject(Helpers.BadImplementationError('cannot resolve "bucket"'));
};


/**
 * returns a randomized key if test is truthy
 *
 * @param {Boolean} test
 * @param {String} key
 * @return {String}
 */
internals.randomizeKey = function (test, key) {

  if (!test) {
    return key;
  }

  const ext = Path.extname(key);
  const dirname = Path.dirname(key);

  const buf = Buffer.alloc(32);
  Uuid.v4(null, buf);
  const randomKey = Hoek.base64urlEncode(buf);

  return Path.join(dirname, `${randomKey}${ext}`);
};


/**
 * resolves with the S3 `Key`
 *
 * @param {Object} request - Hapi request Object
 * @resolves {String} - S3 Key Name, can be `''`
 */
Helpers.getKey = function (request, options = {}) {

  const { key } = request.route.settings.plugins.s3;
  const { formDataKey, fileKey, randomize } = options;

  const getKey = function () {
    if (typeof key === 'function') {
      return Promise.resolve(key(request, formDataKey));
    }

    const prefix = (typeof key === 'string') ? key : '';
    const path = request.params.path || '';
    const postfix = fileKey || '';

    if (!prefix && !path && !postfix) {
      return Promise.reject(Helpers.BadImplementationError('cannot resolve "key"'));
    }

    return Path.join(prefix, path, postfix);
  };

  return Promise.resolve()
    .then(getKey)
    .then((key) => internals.randomizeKey(randomize, key));
};


/**
 * Wrap the Error of a `s3` request into a Boom error.
 *
 * @param {Error} error - error of the `s3` request
 */
Helpers.S3Error = function (error, { bucket, key }) {

  let message;
  const statusCode = error.statusCode || 500;

  if (statusCode === 404) {
    message = `could not find Object: [s3://${bucket}/${key}]`;
  }

  return Boom.create(statusCode, message, Object.assign({}, error));
};

/**
 * resolves with a transformed version of the S3 Object's meta data
 *
 * @param {Object} request - Hapi request Object
 * @param {String} bucket
 * @param {String} key
 */
Helpers.getObjectMetaData = function (request, bucket, key) {

  if (!bucket || !key) {
    return Promise.reject(Helpers.BadImplementationError('bucket or key cannot not be empty'));
  }

  const s3 = Helpers.getS3Client(request);
  return new Promise((resolve, reject) => {

    s3.headObject({ Bucket: bucket, Key: key }, (err, data) => {

      if (err) {
        return reject(Helpers.S3Error(err, { bucket, key }));
      }

      return resolve(data);
    });
  });
};


/**
 * tests if one item in a white-list (regex) matches the given item
 *
 * @param {Array<RegExp>} allowed - whitelist
 * @param {String} item - to be tested item
 * @return {Boolean}
 */
Helpers.hasMatch = function (allowed, item) {

  if (!allowed) {
    return false;
  }

  const { length } = allowed;

  for (let i = 0; i < length; ++i) { // eslint-disable-line no-plusplus
    const val = allowed[i];

    if ((val instanceof RegExp && val.test(item)) ||
        (val === item)) {

      return true;
    }
  }

  return false;
};


/**
 * returns the type for the Content-Type Header
 */
Helpers.getContentType = function (request, bucket, key, options = {}) {

  const { overrideContentTypes, contentType } = request.route.settings.plugins.s3;

  const getContentType = function () {

    if (typeof contentType === 'string') {
      return contentType;
    }

    if (typeof contentType === 'function') {
      return Promise.resolve(contentType(request, { bucket, key, contentType: options.ContentType }));
    }

    return options.ContentType;
  };

  const applyOverrides = function (type) {

    if (type && overrideContentTypes && overrideContentTypes[type]) {
      return overrideContentTypes[type];
    }

    return type;
  };

  return Promise.resolve()
    .then(getContentType)
    .then(applyOverrides);
};


/**
 * resolves the `filename` for the Content-Disposition header
 *
 * @param {Func|String|null} request...filename
 * - if function: filename(request, { bucket, key, [filename] }) -> Promise|String
 *   - `filename`: content dispostion file name on S3 / POST form data
 * - if not given:
 *   - if mode=attachment|inline: use the S3 ContentType / FormData if exists
 *   - if mode=auto|false: don't set a content-dispostion header
 */
internals.getFilename = function (request, bucket, key, options = {}) {

  const { filename, getMode } = request.route.settings.plugins.s3;
  const mode = getMode(request);

  if (typeof filename === 'function') {
    return Promise.resolve(filename(request, { bucket, key, filename: options.filename }));
  }

  if (!filename && (mode === 'attachment' || mode === 'inline')) {
    return Promise.resolve(Path.basename(key));
  }

  return Promise.resolve(options.filename);
};


/**
 * returns the disposition for the Content-Disposition Header
 */
Helpers.getContentDisposition = function (request, bucket, key, options = {}) {

  const { getMode } = request.route.settings.plugins.s3;
  const mode = getMode(request);

  if (!mode) {
    return Promise.resolve();
  }

  let filename;
  let type;

  if (options.ContentDisposition) {
    const disposition = ContentDisposition.parse(options.ContentDisposition);
    const dispositionType = Hoek.reach(disposition, 'type');
    if (dispositionType === 'inline' || dispositionType === 'attachment') {
      type = dispositionType;
    }

    filename = Hoek.reach(disposition, 'parameters.filename');
  }

  if (mode === 'auto' && !type) {
    // if mode is `auto` but no `type` found, default to 'attachment'
    type = 'attachment';
  }

  if (mode !== 'auto') {
    type = mode;
  }

  return Promise.resolve()
    .then(() => internals.getFilename(request, bucket, key, { filename }))
    .then((fname) => {
      if (!fname) {
        return null;
      }

      return ContentDisposition(fname, { type });
    });
};


/**
 * Common Error Handling for the S3 Handler
 *
 * @param {Request} request
 * @param {Reply} reply
 * @returns {ErrorHandler}
 */
Helpers.replyWithError = function (request, reply) {

  return function (err) {

    const { onResponse } = request.route.settings.plugins.s3;
    const error = Boom.wrap(err);

    // delegate reply if configured
    if (onResponse) {
      return onResponse(error, null, request, reply, null);
    }

    // default reply strategy
    return reply(error);
  };
};

const Hoek = require('hoek');
const Joi = require('joi');

const Helpers = require('./helpers');

const Schemas = exports;
const internals = {};


// `mode` schema definition
internals.defaultMode = 'auto';
internals.Modes = Joi.valid([false, 'auto', 'attachment', 'inline']).default(internals.defaultMode);
internals.ModeObject = Joi.object()
  .keys({
    get: internals.Modes,
    post: internals.Modes
  });


// getter for the `mode` attribute
Schemas.getMode = function (request) {

  const { mode } = request.route.settings.plugins.s3;
  const { method } = request;

  if (typeof mode !== 'object') {
    return mode;
  }

  return Hoek.reach(mode, method, internals.defaultMode);
};


/**
 * Schema Definition of the `GET` Route Options
 */
Schemas.routeOptionsSchema = Joi.object()
  .keys({
    // If a string is provided it will be used as bucket name.
    // If a function is provided, it should return or resolve the `bucket`.
    //   - if function: bucket(request) -> Promise|String
    bucket: Joi.alternatives()
      .try(
        Joi.string(),
        Joi.func()
      )
      .required(),

    // If a string is provided, then it will be used to look up the key:
    //   - if the route contains a parameter "path", the key will be treated as a prefix
    //   - otherwise, the key will be treated as the literal S3 key
    //   - for "POST": always used as prefix
    // If a function is provided, it should return or resolve the `key`.
    //   - if function: key(request) -> Promise|String
    // If not given try:
    //   - to use the "path" parameter
    //   - 'POST': try to use the FormData's key name
    key: Joi.alternatives()
      .try(
        Joi.string(),
        Joi.func()
      )
      .optional(),

    // If set, randomizes the S3 Key (basename) for POST request
    randomPostKeys: Joi.boolean().optional(),

    // Specifies whether to include the Content-Disposition header.
    // - if `false`: no content-disposition header will be set
    // - if `auto`:
    //   - for 'GET':
    //     - try to load header from S3 directly
    //     - try 'attachment'
    //   - for 'POST'
    //     - try 'attachment'
    // - if `attachment`: content-disposition will always be set to 'attachment'
    // - if `inline`: content-disposition will always be set to 'inline'
    // - if `<object>`: key=['get', 'post', ...] value=<mode>
    mode: internals.Modes.valid(internals.ModeObject),

    // Get the `filename` for the content-disposition header.
    // If given, the function should return or resolve the `filename`.
    // `filename` will then be added to the Content-Disposition header.
    // [@see Content-Disposition](https://www.w3.org/Protocols/rfc2616/rfc2616-sec19.html#sec19.5.1)
    // - if function: filename(request, { bucket, key, [filename] }) -> Promise|String
    //   - `filename`: content disposition file name on S3 / POST form data
    // - if not given:
    //   - if mode=auto: use the S3 ContentType / FormData if exists
    //   - if mode=attachment|inline: use the key's basename
    filename: Joi.alternatives()
      .when('mode', {
        is: false,
        then: Joi.forbidden(),
        otherwise: Joi.func().optional()
      }),

    // If S3's reported content-type is key, replace it with value
    // example: { "application/octet-stream" : "application/pdf" }
    overrideContentTypes: Joi.object().optional().default({}),

    // for `POST` requests, check if the content type is allowed to be uploaded
    // - if `undefined` is part of the list, also allow if no content type was found / will be set
    allowedContentTypes: Joi.array()
      .items(
        Joi.object().type(RegExp),
        Joi.string()
      )
      .sparse(true) // allow undefined
      .optional()
      .description('list of allowed content-types'),

    // for `POST` request, don't try to upload FormData entries with
    // the given names
    ignoredFormKeys: Joi.array()
      .items(
        Joi.object().type(RegExp),
        Joi.string()
      )
      .description('list of ignored form entries based on the form key'),

    // Set the content-type header to the given value.
    // - if string: use as is
    // - if function: contentType(request, { bucket, key, [contentType] }) -> Promise|String
    //   - `contentType`: content type on S3 / POST form data
    // - if not given:
    //   - use the S3 ContentType / FormData if exists
    contentType: Joi.alternatives()
      .try(
        Joi.string(),
        Joi.func()
      )
      .optional(),

    // on response handler to update the response
    // - onResponse(error, res, request, reply, options) -> void
    //   - res:
    //     - "GET": file object stream
    //     - "POST": S3 Response, extended with ContentType and ContentDisposition if possible
    //     - "DELETE": null
    //   - options:
    //     - "GET": Object<{ bucket, key, contentType, contentDisposition, defaultStatusCode, data }>
    //     - "POST": Object<{ uploads: Array<Object<{ file: String, bucket, key, contentType, contentDisposition, defaultStatusCode, data }>> }>
    //     - "DELETE": Object<{ bucket, key, defaultStatusCode, data, s3Response }>
    onResponse: Joi.func().description('custom reply function'),

    // bucket's region (defaults to us-standard: us-east-1)
    region: Joi.string().optional().default('us-east-1'),

    // use SSL when communicating with S3 (default true)
    sslEnabled: Joi.boolean().default(true),

    // key id and secret key (defaults to environment)
    accessKeyId: Joi.string().optional().default(process.env.AWS_ACCESS_KEY_ID),
    secretAccessKey: Joi.string().optional().default(process.env.AWS_SECRET_ACCESS_KEY),

    // additional aws s3 options
    // [@see nodejs aws-sdk](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property)
    s3Params: Joi.object().optional().unknown(true).default({})
  });


internals.ResponsePostS3ResponseSchema = Joi.object()
  .keys({
    Location: Joi.string().required().description('s3 upload location'),
    ContentType: Joi.string().description('s3 content type'),
    ContentDisposition: Joi.string().description('s3 content disposition')
  })
  .unknown(true)
  .required()
  .description('s3 response of the upload request');


/**
 * Reply Response Schema Definition
 */
Schemas.ResponseSchema = {
  get: Joi.any()
    .required()
    .description('s3 response file stream'),

  post: Joi.object()
    .unknown(true)
    .pattern(/.*/, internals.ResponsePostS3ResponseSchema)
    .description('Object keyed by the FormData keys, where the values are S3 upload responses'),

  delete: Joi.only(null)
};


/**
 * `onResponse` options common keys
 */
internals.onResponseOptionsCommonKeys = {
  bucket: Joi.string().required().description('s3 bucket'),
  key: Joi.string().required().description('s3 key'),
  contentType: Joi.string().optional(),
  contentDisposition: Joi.string().optional(),
  defaultStatusCode: Joi.number().integer().required().description('http response code for the default reply'),
  data: Joi.any()
    .required()
    .description('that data that would be passed to the reply interface')
};


/**
 * Schema definition for the `onResponse` options parameter
 */
internals.onResponseOptionsSchema = {
  get: Joi.object()
    .keys(internals.onResponseOptionsCommonKeys)
    .keys({
      defaultStatusCode: Joi.only(200),
      data: Schemas.ResponseSchema.get
    })
    .required(),

  post: Joi.object()
    .keys({
      uploads: Joi.array()
        .items(Joi.object()
          .keys(Helpers.omit(internals.onResponseOptionsCommonKeys, ['defaultStatusCode']))
          .keys({
            file: Joi.string().required().description('FormData key'),
            data: internals.ResponsePostS3ResponseSchema
          })),
      defaultStatusCode: Joi.only(201)
    })
    .required(),

  delete: Joi.object()
    .keys(Helpers.omit(internals.onResponseOptionsCommonKeys, ['contentType', 'contentDisposition']))
    .keys({
      defaultStatusCode: Joi.only(204),
      data: Schemas.ResponseSchema.delete,
      s3Response: Joi.object()
        .unknown(true)
        .required()
        .description('s3 response of the `deleteObject` request')
    })
    .required()
};


/**
 * `onResponse` Parameters Schema Definition
 */
Schemas.onResponseParamsSchema = {
  get: Joi.array()
    .ordered(
      Joi.any().optional().description('error'),
      Joi.alternatives().try([
        Schemas.ResponseSchema.get,
        Joi.valid(null)
      ]),
      Joi.any().optional().description('reply'),
      Joi.any().optional().description('request'),
      Joi.alternatives().try([
        internals.onResponseOptionsSchema.get,
        Joi.only(null)
      ])
    )
    .required(),

  post: Joi.array()
    .ordered(
      Joi.any().optional().description('error'),
      Joi.alternatives().try([
        Schemas.ResponseSchema.post,
        Joi.only(null)
      ]),
      Joi.any().optional().description('reply'),
      Joi.any().optional().description('request'),
      Joi.alternatives().try([
        internals.onResponseOptionsSchema.post,
        Joi.only(null)
      ])
    )
    .required(),

  delete: Joi.array()
    .ordered(
      Joi.any().optional().description('error'),
      Joi.alternatives().try([
        Schemas.ResponseSchema.delete,
        Joi.only(null)
      ]),
      Joi.any().optional().description('reply'),
      Joi.any().optional().description('request'),
      Joi.alternatives().try([
        internals.onResponseOptionsSchema.delete,
        Joi.only(null)
      ])
    )
    .required()
};

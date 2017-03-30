const Hoek = require('hoek');
const Joi = require('joi');

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
 * Schema Defintion of the `GET` Route Options
 */
Schemas.routeOptionsSchema = Joi.object()
  .keys({
    // If a string is provided it will be used as bucket name.
    // If a function is provided, it should return or resolve the `bucket`.
    // - if function: bucket(request) -> Promise|String
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
    // - if function: key(request) -> Promise|String
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
    //     - try 'attachement'
    // - if `attachment`: content-disposition will always be set to 'attachment'
    // - if `inline`: content-disposition will always be set to 'inline'
    // - if `<object>`: key=['get', 'post', ...] value=<mode>
    mode: internals.Modes.valid(internals.ModeObject),

    // Get the `filename` for the content-disposition header.
    // If given, the function should return or resolve the `filename`.
    // - if function: filename(request, { bucket, key, [filename] }) -> Promise|String
    //   - `filename`: content dispostion file name on S3 / POST form data
    // - if not given:
    //   - if mode=auto: use the S3 ContentType / FormData if exists
    //   - if mode=attachment|inline: use the key's basenamece
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

    // for `POST` requets, don't try to upload FormData entries with
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
    //   - options:
    //     - "GET": Object<{ bucket, key, contentType, contentDisposition, defaultStatusCode }>
    //     - "POST": Object<{ uploads: Array<Object<{ file: String, bucket, key, contentType, contentDisposition, defaultStatusCode }>> }>
    onResponse: Joi.func().description('custom reply function'),

    // bucket's region (defaults to us-standard: us-east-1)
    region: Joi.string().optional().default('us-east-1'),

    // use SSL when communicating with S3 (default true)
    sslEnabled: Joi.boolean().default(true),

    // key id and secret key (defaults to environment)
    accessKeyId: Joi.string().optional().default(process.env.AWS_ACCESS_KEY_ID),
    secretAccessKey: Joi.string().optional().default(process.env.AWS_SECRET_ACCESS_KEY),

    // additional aws s3 options
    s3Params: Joi.object().optional().unknown(true).default({})
  });

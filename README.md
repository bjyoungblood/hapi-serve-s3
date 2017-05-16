# hapi-serve-s3

[![Build Status](https://travis-ci.org/bjyoungblood/hapi-serve-s3.svg?branch=master)](https://travis-ci.org/bjyoungblood/hapi-serve-s3)
[![Dependency Status](https://david-dm.org/bjyoungblood/hapi-serve-s3.svg)](https://david-dm.org/bjyoungblood/hapi-serve-s3)

Easily serve files from an S3 bucket.

## Plugin Usage

Register the plugin to your hapi server:

```javascript
server.register(require('hapi-serve-s3'), function(err) {
  if (err) {
    throw err;
  }
});
```

### Plugin options

None so far.

## Route Definition

Use `s3` as a handler:

```javascript
// Serve a file from s3://my-awesome-bucket/path/to/file.pdf
serve.route({
  method: 'GET',
  route: '/file.pdf',
  handler: {
    s3: {
      bucket: 'my-awesome-bucket',
      mode: 'attachment',
      filename: function(request) { // when downloaded from a browser, this will be the recommended download name
        return Promise.resolve('awesome-pdf.pdf');
      },
      key: function(request) {
        return Promise.resolve('path/to/file.pdf');
      },
      overrideContentTypes: {
        // application/octet-stream is the default that S3 serves if you don't
        // tell them the MIME type when uploading the file
        'application/octet-stream': 'application/pdf',
      },
    },
  },
});
```

```javascript
// Upload + Serve files from s3://my-awesome-bucket/path/to/*.pdf
serve.route({
  method: ['GET', 'POST'],
  route: '/files/{path*}',
  handler: {
    s3: {
      bucket: 'my-awesome-bucket',
      mode: 'attachment',
      key: 'path/to',
      overrideContentTypes: {
        // application/octet-stream is the default that S3 serves if you don't
        // tell them the MIME type when uploading the file
        'application/octet-stream': 'application/pdf',
      },
    },
  },
});
```

```javascript
// Upload + Serve + Delete files from s3 with custom authentication strategy
serve.route({
  method: ['GET', 'POST', 'DELETE'],
  route: '/files/{path*}',
  handler: {
    s3: {
      bucket: 'my-awesome-bucket',
      key: function(request)  {
        return request.pre.authPath
      }
    },
  },
  config: {
    pre: [
      {
        assign: 'authPath',
        method: function(request, reply) {
          // ... auth strategy here
          if (!ok) {
            return reply(Boom.unauthorized())
          }

          return replay(key)
        }
      }
    ]
  }
});
```

```javascript
// Custom reply strategy
serve.route({
  method: 'POST',
  route: '/files/{path*}',
  handler: {
    s3: {
      bucket: 'my-awesome-bucket',
      onResponse(err, res, request, reply, options) {
        if (err) {
          return reply(err);
        }

        const myPayload options.uploads.map(/* custom mapping */);
        return reply(myPayload).code(options.defaultStatusCode);
      }
    },
  }
});
```

### Handler Options:

- `bucket` *(String|Function)*
    - If a string is provided it will be used as bucket name.
    - If a function is provided, it should return or resolve the `bucket`.
        - if function: bucket(request) -> Promise|String
- `key` *([String|Function])*
    - If a string is provided, then it will be used to look up the key:
        - if the route contains a parameter "path", the key will be treated as a prefix
          otherwise, the key will be treated as the literal S3 key
        - for "POST": always used as prefix
    - If a function is provided, it should return or resolve the `key`.
        - if function: key(request) -> Promise|String
    - If not given try:
        - to use the "path" parameter
        - 'POST': try to use the FormData's key name
- `randomPostKeys` *([Bool]) default=false*
    - If set, randomizes the S3 Key (basename) for POST request
- `mode` *([Bool|String]) default=auto*
    - Specifies whether to include the Content-Disposition header.
        - if `false`: no content-disposition header will be set
        - if `auto`:
            - for 'GET':
                - try to load header from S3 directly
                - try 'attachment'
            - for 'POST'
                - try 'attachement'
        - if `attachment`: content-disposition will always be set to 'attachment'
        - if `inline`: content-disposition will always be set to 'inline'
        - if `<object>`: key=['get', 'post', ...] value=<mode>
- `filename` *([Function])*
    - Get the `filename` for the content-disposition header.
    - If given, the function should return or resolve the `filename`.
      `filename` will then be added to the Content-Disposition header.
      [@see Content-Disposition](https://www.w3.org/Protocols/rfc2616/rfc2616-sec19.html#sec19.5.1)
        - if function: filename(request, { bucket, key, [filename] }) -> Promise|String
            - `filename`: content dispostion file name on S3 / POST form data
        - if not given:
            - if mode=auto: use the S3 ContentType / FormData if exists
            - if mode=attachment|inline: use the key's basenamece
- `overrideContentTypes` *([Object]) default={}*
    - If S3's reported content-type is key, replace it with value
      example: { "application/octet-stream" : "application/pdf" }
- `allowedContentTypes` *([Array<String|RegExp>])*
    - for `POST` requests, check if the content type is allowed to be uploaded
       - if `undefined` is part of the list, also allow if no content type was found / will be set
- `ignoredFormKeys` *([Array<String|RegExp>])*
    - for `POST` requets, don't try to upload FormData entries with
      the given names
- `contentType` *([String|Function])*
    - Set the content-type header to the given value.
        - if string: use as is
        - if function: contentType(request, { bucket, key, [contentType] }) -> Promise|String
            - `contentType`: content type on S3 / POST form data
        - if not given:
            - use the S3 ContentType / FormData if exists
- `onResponse` *([Function])*
    - on response handler to update the response
    - onResponse(error, res, request, reply, options) -> void
        - res:
            - "GET": file object stream
            - "POST": S3 Response, extended with ContentType and ContentDisposition if possible
            - "DELETE": null
        - options:
            - "GET": Object<{ bucket, key, contentType, contentDisposition, defaultStatusCode, data }>
            - "POST": Object<{ uploads: Array<Object<{ file: String, bucket, key, contentType, contentDisposition, defaultStatusCode, data }>> }>
            - "DELETE": Object<{ bucket, key, defaultStatusCode, data, s3Response }>
- `region` *([String]) default='us-east-1'*
    - bucket's region (defaults to us-standard: us-east-1)
- `sslEnabled` *([Bool]) default=true*
    - use SSL when communicating with S3 (default true)
- `accessKeyId` *([String]) default=process.env.AWS_ACCESS_KEY_ID*
- `secretAccessKey` *([String]) default=process.env.AWS_SECRET_ACCESS_KEY*
- `s3Params` *([Object])*
    - additional aws s3 options [@see nodejs aws-sdk](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property)

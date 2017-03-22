# hapi-serve-s3

[![Build Status](https://travis-ci.org/bjyoungblood/hapi-serve-s3.svg?branch=master)](https://travis-ci.org/bjyoungblood/hapi-serve-s3)
[![Dependency Status](https://david-dm.org/bjyoungblood/hapi-serve-s3.svg)](https://david-dm.org/bjyoungblood/hapi-serve-s3)

Easily serve files from an S3 bucket.

## Plugin Usage

Register the plugin to your hapi server:

```javascript
server.register({
  register: require('hapi-serve-s3'),
}, function(err) {
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
// Serve files from s3://my-awesome-bucket/path/to/*.pdf
serve.route({
  method: 'GET',
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
// Serve files from s3 with custom authentication strategy
serve.route({
  method: 'GET',
  route: '/files/{path*}',
  handler: {
    s3: {
      bucket: 'my-awesome-bucket',
      mode: 'attachment',
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

### Handler Options:

- `mode` *(Bool|String) default=false*
    - Specifies whether to include the Content-Disposition header.
    - must be one of: `false`, `'attachment'`, `'inline'`, `s3`
    - if `s3` mode, before loading the file, a head request is performed, to
      fetch the configured *Content-Disposition* header from S3. If one was found
      this will be the returned *Content-Disposition* filename and type, otherwise
      defaults to the S3 key's filename.
- `filename` *([Function])*
    - If provided, the function will receive the request and it should return a promise
      that resolves the mapped `filename`. `filename` will then be added to the
      Content-Disposition header. [@see Content-Disposition](https://www.w3.org/Protocols/rfc2616/rfc2616-sec19.html#sec19.5.1)
    - If mode is not `false` and no function is given `filename` will be set to the S3 key's filename.
- `overrideContentTypes` *(Object) default={}*
    - If S3's reported content-type is a key, it will be replaced with the mapped value
      example: { "application/octet-stream" : "application/pdf" }
- `region` *(String) default='us-east-1'*
- `bucket` *(String|Function)*
    - If a string is provided it will be used as bucket name.
    - If a function is proviced, it will receive the request and should return
      a promise that resolves the mapped `bucket`.
- `key` *([String|Function])*
    - If a string is provided, then it will be used to look up the key:
        - if the route contains a parameter called "path", the key will be treated as a prefix
        - otherwise, the key will be treated as a literal S3 key
    - If a function is provided, it will receive the request and it should return a promise
      that resolves the mapped `key`.
- `sslEnabled` *(Bool) default=true*
- `accessKeyId` *([String]) default=process.env.AWS_ACCESS_KEY_ID*
- `secretAccessKey` *([String]) default=process.env.AWS_SECRET_ACCESS_KEY*
- `s3Params` *([Object])*
    - additional aws s3 options [@see nodejs aws-sdk](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor-property)

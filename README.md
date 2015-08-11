# hapi-serve-s3

Easily serve files from an S3 bucket.

## Usage

```js
server.register({
  register : require('hapi-serve-s3'),
}, function(err) {
  if (err) { throw err; }
});
```

```
// Serve a file from s3://my-awesome-bucket/path/to/file.pdf
serve.route({
  method : GET',
  route : '/file.pdf',
  handler : {
    s3 : {
      bucket : 'my-awesome-bucket',

      mode : 'attachment',
      filename : function(request, cb) {
        setImmediate(function() {
          cb(null, 'awesome-pdf.pdf');
        });
      },
      key : function(request, cb) {
        setImmediate(function() {
          cb(null, 'path/to/file.pdf');
        });
      },
      overrideContentTypes : {
        // application/octet-stream is the default that S3 serves if you don't
        // tell them the MIME type when uploading the file
        'application/octet-stream' : 'application/pdf',
      },
    },
  },
});

// Serve files from s3://my-awesome-bucket/path/to/*.pdf
serve.route({
  method : GET',
  route : '/files/{path*}',
  handler : {
    s3 : {
      bucket : 'my-awesome-bucket',

      mode : 'attachment',
      filename : function(request, cb) {
        setImmediate(function() {
          cb(null, 'awesome-pdf.pdf');
        });
      },
      key : 'path/to',
      overrideContentTypes : {
        // application/octet-stream is the default that S3 serves if you don't
        // tell them the MIME type when uploading the file
        'application/octet-stream' : 'application/pdf',
      },
    },
  },
});
```

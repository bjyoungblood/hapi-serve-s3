/* eslint prefer-arrow-callback: 0 */

const Path = require('path');

const AWS = require('aws-sdk');
const Hapi = require('hapi');
const Joi = require('joi');
const RimRaf = require('rimraf');
const S3rver = require('s3rver');

const Helpers = require('./helpers');
const HapiServeS3 = require('../src');
const Schemas = require('../src/schemas');

const expect = require('expect');

process.env.AWS_ACCESS_KEY_ID = 'FAKE';
process.env.AWS_SECRET_ACCESS_KEY = 'FAKE';

describe('[integration/upload] "POST" spec', function () {
  let server;
  let s3rver;

  before('create a mocked s3 server', function (done) {
    const params = {
      port: 4569,
      hostname: 'localhost',
      silent: true,
      directory: Path.join(__dirname, './fixtures/buckets')
    };

    s3rver = new S3rver(params).run(done);
  });

  after('stop s3rver', function (done) {
    s3rver.close(done);
  });

  before('load hapi server with serve-s3 plugin', function () {
    server = new Hapi.Server();
    server.connection({ port: 8888 });

    return server.register({
      register: HapiServeS3,
      options: {}
    });
  });

  after('stop server', function () {
    return server.stop();
  });

  describe('[mode=auto][no key][allowedContentTypes with `undefined`]', function () {
    before('define route', function () {
      return server.route({
        method: ['GET', 'POST'],
        path: '/files/{path?}',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            // use RegExp and String
            allowedContentTypes: [/image\/*/, 'application/pdf', undefined]
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'test', buf: content, filename: 'test-NF.pdf' },
        { name: 'file2', buf: content, filename: 'file-test2.jpg' },
        { name: 'withoutFilename', buf: content }
      ];

      let response;
      let formData;
      let fileResponses;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      before('reload files', function () {
        return Helpers.reloadFiles(files, { server, prefix: '/files/' })
          .then((responses) => {
            fileResponses = responses;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/file-test2.jpg'));
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/test-NF.pdf'));
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/withoutFilename'));
      });

      it('should respond with 201 (Created)', function () {
        expect(response.statusCode).toEqual(201);
      });

      it('should respond with s3 upload data and prefer the content-disposition filename as Key', function () {
        const payload = JSON.parse(response.payload);

        expect(payload).toInclude({
          test: { Key: 'test-NF.pdf' },
          file2: { Key: 'file-test2.jpg' },
          withoutFilename: { Key: 'withoutFilename' }
        });
      });

      it('should extend the S3 Data with ContentDisposition and ContentType', function () {
        const payload = JSON.parse(response.payload);

        expect(payload).toInclude({
          test: { ContentType: 'application/pdf', ContentDisposition: 'attachment; filename="test-NF.pdf"' }
        });
      });

      it('should set the correct content-type headers based on the form data', function () {
        expect(fileResponses.file2.headers['content-type']).toEqual('image/jpeg');
        expect(fileResponses.test.headers['content-type']).toEqual('application/pdf');
        expect(fileResponses.withoutFilename.headers['content-type']).toEqual('application/octet-stream');
      });

      it('should set the correct content-disposition headers based on the form data', function () {
        expect(fileResponses.file2.headers['content-disposition'])
          .toEqual('attachment; filename="file-test2.jpg"');

        expect(fileResponses.test.headers['content-disposition'])
          .toEqual('attachment; filename="test-NF.pdf"');

        expect(fileResponses.withoutFilename.headers['content-disposition']).toNotExist();
      });
    });

    describe('with existing file', function () {
      const content = Buffer.from('Test 2 PDF\nxxx\n');
      const files = [
        { name: 'files2/1.pdf', buf: content }
      ];

      let response;
      let formData;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 409 (Conflict)', function () {
        expect(response.statusCode).toEqual(409);
      });
    });

    describe('with blacklisted content-type', function () {
      const content = Buffer.from('Test 2 Latex\nxxx\n');
      const files = [
        { name: 'thesis.latex', buf: content, filename: 'thesis.latex' }
      ];

      let response;
      let formData;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 415 (Unsupported Media Type)', function () {
        expect(response.statusCode).toEqual(415);
      });
    });

    describe('with no multi-part upload', function () {
      let response;

      before('call api', function () {
        const params = {
          method: 'POST',
          url: '/files/',
          payload: { file: 'this is my file' }
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 415 (Unsupported Media Type)', function () {
        expect(response.statusCode).toEqual(415);
      });
    });
  });

  describe('[mode=auto][key as string]', function () {
    before('define route', function () {
      return server.route({
        method: ['GET', 'POST'],
        path: '/files2/{path?}',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            key: 'files3' // used as prefix
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'test', buf: content, filename: 'test-NF.pdf' }
      ];

      let response;
      let formData;
      let fileResponses;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload files', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files2/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      before('reload files', function () {
        return Helpers.reloadFiles(files, { server, prefix: '/files2/' })
          .then((responses) => {
            fileResponses = responses;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/files3'));
      });

      it('should respond with 201 (Created)', function () {
        expect(response.statusCode).toEqual(201);
      });

      it('should be possible to GET the file afterwards', function () {
        expect(fileResponses.test.statusCode).toEqual(200);
      });
    });
  });

  describe('[mode=auto][key as function]', function () {
    before('define route', function () {
      return server.route({
        method: ['GET', 'POST'],
        path: '/files3/{path?}',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            key: (request, formDataKey) => {
              if (request.method === 'post') {
                const { filename } = request.payload[formDataKey].hapi;
                return `files4/${filename}`;
              }
              const filename = request.url.path.split('/').reverse()[0];
              return `files4/${filename}`;
            }
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'fileA', buf: content, filename: 'document.pdf' },
        { name: 'fileB', buf: content, filename: 'image.png' }
      ];

      let response;
      let formData;
      let fileResponses;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload files', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files3/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      before('reload files', function () {
        return Helpers.reloadFiles(files, { server, prefix: '/files3/' })
          .then((responses) => {
            fileResponses = responses;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/files4'));
      });

      it('should respond with 201 (Created)', function () {
        expect(response.statusCode).toEqual(201);
      });

      it('should be possible to GET the file afterwards', function () {
        expect(fileResponses.fileA.statusCode).toEqual(200);
      });

      it('should respond with s3 upload data and include sub-folder in filename', function () {
        const payload = JSON.parse(response.payload);

        expect(payload).toInclude({
          fileA: { Key: 'files4/document.pdf' },
          fileB: { Key: 'files4/image.png' }
        });
      });
    });
  });

  describe('[onResponse]', function () {
    let onResponseError;

    before('define route', function () {
      return server.route({
        method: ['GET', 'POST'],
        path: '/files4/{path?}',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            onResponse(...args) {
              const [err, res, request, reply, options] = args; // eslint-disable-line no-unused-vars

              const { error } = Joi.validate(args, Schemas.onResponseParamsSchema.post);
              onResponseError = error;

              if (err) {
                return reply({ message: 'there was an error' });
              }

              const transformedPayload = Object.keys(res)
                .map((key) => {
                  const upload = res[key];
                  const path = Path.join('/files/', upload.key);

                  return { location: `http://127.0.0.1${path}` };
                });

              return reply(transformedPayload)
                .code(200);
            }
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'test', buf: content }
      ];

      let response;
      let formData;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files4/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/test'));
      });

      it('should call `onResponse` with the correct schema', function () {
        expect(onResponseError).toNotExist();
      });

      it('should respond with the intercepted status code', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should respond with the intercepted payload', function () {
        const payload = JSON.parse(response.payload);

        expect(payload.length).toEqual(1);
        expect(payload[0]).toInclude({
          location: 'http://127.0.0.1/files/test'
        });
      });
    });

    describe('bad request', function () {
      let response;

      before('upload invalid content', function () {
        const params = {
          method: 'POST',
          url: '/files4/',
          payload: { not: 'supported' }
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/test'));
      });

      it('should call `onResponse` with the correct schema', function () {
        expect(onResponseError).toNotExist();
      });

      it('should respond with the intercepted status code', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should respond with the intercepted payload', function () {
        const payload = JSON.parse(response.payload);

        expect(payload).toInclude({ message: 'there was an error' });
      });
    });
  });

  describe('[randomPostKeys]', function () {
    before('define route', function () {
      return server.route({
        method: ['GET', 'POST'],
        path: '/files5/{path?}',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            key: 'prefixxxed',
            randomPostKeys: true
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'file.pdf', buf: content, filename: 'test-NF.pdf' }
      ];

      let response;
      let formData;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files5/',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/prefixxxed'));
      });

      it('should respond with HTTP 201 (Created)', function () {
        expect(response.statusCode).toEqual(201);
      });

      it('should respond with the randomized key', function () {
        const payload = JSON.parse(response.payload);

        expect(payload['file.pdf']).toExist();
        expect(payload['file.pdf'].Key).toExist();
        expect(payload['file.pdf'].Key).toNotEqual('file.pdf');
        expect(payload['file.pdf'].Key.length).toBeGreaterThan(15);
      });

      it('should preserve the files extension and prefix (dirname)', function () {
        const payload = JSON.parse(response.payload);

        expect(payload['file.pdf'].Key).toMatch(/^prefixxxed\/.*\.pdf$/);
      });
    });
  });

  describe('multi-level paths with `key`', function () {
    before('define route', function () {
      return server.route({
        method: ['GET', 'POST', 'DELETE'],
        path: '/files6/{path*}',
        handler: {
          s3: {
            s3Params: {
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            key: 'files2' // prefix
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'test', buf: content, filename: 'test-NF.pdf' }
      ];

      let response;
      let formData;
      let getResponse;
      let deleteResponse;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files6/deeper/and/deeper',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      before('reload file', function () {
        const params = {
          method: 'GET',
          url: '/files6/deeper/and/deeper/test-NF.pdf'
        };

        return server.inject(params)
          .then((resp) => {
            getResponse = resp;
          });
      });

      before('delete file', function () {
        const params = {
          method: 'DELETE',
          url: '/files6/deeper/and/deeper/test-NF.pdf'
        };

        return server.inject(params)
          .then((resp) => {
            deleteResponse = resp;
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/files2/deeper/and'));
      });

      it('should respond with HTTP 201 (Created)', function () {
        expect(response.statusCode).toEqual(201);
      });

      it('should respond with the nested key: `key/{path*}/filename`', function () {
        const payload = JSON.parse(response.payload);

        expect(payload.test.Key).toEqual('files2/deeper/and/deeper/test-NF.pdf');
      });

      it('should be possible to load the file', function () {
        expect(getResponse.statusCode).toEqual(200);
      });

      it('should be possible to delete the file', function () {
        expect(deleteResponse.statusCode).toEqual(204);
      });
    });
  });

  describe('[ignoredFormKeys]', function () {
    before('define route', function () {
      return server.route({
        method: ['GET', 'POST', 'DELETE'],
        path: '/files7/{path*}',
        handler: {
          s3: {
            s3Params: {
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            randomPostKeys: true,
            ignoredFormKeys: ['options']
          }
        }
      });
    });

    describe('valid request', function () {
      const content = Buffer.from('123\nTest PDF\nxxx');
      const files = [
        { name: 'file', buf: content, filename: 'this-is-the-filename.pdf' },
        { name: 'options', buf: Buffer.from(JSON.stringify({ labels: [{ Key: 'User', Value: 'user_1' }] })) }
      ];

      let response;
      let rpayload;
      let formData;

      before('get form data', function () {
        return Helpers.getFormData(files)
          .then((data) => {
            formData = data;
          });
      });

      before('upload file via form data', function () {
        const { payload, form } = formData;

        const params = {
          method: 'POST',
          url: '/files7/files2',
          headers: form.getHeaders(),
          payload
        };

        return server.inject(params)
          .then((res) => {
            response = res;
            rpayload = JSON.parse(response.payload);
          });
      });

      after('cleanup files', function () {
        RimRaf.sync(Path.resolve(__dirname, `./fixtures/buckets/test/${rpayload.file.Key}`));
      });

      it('should respond with HTTP 201 (Created)', function () {
        expect(response.statusCode).toEqual(201);
      });

      it('should respond with the uploaded file', function () {
        expect(rpayload.file).toExist();
      });

      it('should not respond with the ignored form key', function () {
        expect(rpayload.options).toNotExist();
      });
    });
  });
});

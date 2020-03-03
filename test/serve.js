/* eslint prefer-arrow-callback: 0 */

const Path = require('path');

const AWS = require('aws-sdk');
const Boom = require('boom');
const Hapi = require('hapi');
const Joi = require('joi');
const S3rver = require('s3rver');
const expect = require('expect');

const HapiServeS3 = require('../src');
const Schemas = require('../src/schemas');

process.env.AWS_ACCESS_KEY_ID = 'FAKE';
process.env.AWS_SECRET_ACCESS_KEY = 'FAKE';

describe('[integration/serve] "GET" spec', function () {
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

  describe('[mode=inline][bucket|key|filename as function][overrideContentTypes]', function () {
    before('define a test route', function () {
      return server.route({
        method: 'GET',
        path: '/files/{filename}.pdf',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            // forch mode to `inline`
            mode: 'inline',
            bucket: (request) => request.pre.authorized.bucket,
            key: (request) => request.pre.authorized.key,
            filename: (request) => `${request.params.filename}.pdf`,
            // if not specified differently the default S3 content type is "application/octet-stream"
            overrideContentTypes: {
              'application/octet-stream': 'application/pdf'
            }
          }
        },
        config: {
          pre: [{
            assign: 'authorized',
            // validate / authorize request resource
            method(request, reply) {
              const { params: { filename } } = request;

              if (filename !== '1') {
                return reply(Boom.unauthorized('filename is not valid'));
              }

              return reply({ bucket: 'test', key: 'files/1.pdf' });
            }
          }],
          validate: {
            params: {
              filename: Joi.string().required()
            }
          }
        }
      });
    });

    describe('valid request', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files/1.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 200 (OK)', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should use the `overrideContentTypes` to set the correct content-type header', function () {
        expect(response.headers['content-type']).toEqual('application/pdf');
      });

      it('should force set mode and filename for the content-disposition headers', function () {
        expect(response.headers['content-disposition']).toEqual('inline; filename="1.pdf"');
      });

      it('should respond with the content of the correct s3 file', function () {
        expect(response.payload).toEqual('test\ntest\ntest\ntest\n');
      });
    });

    describe('test custom validation pre handler', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files/2.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 401 (Unauthorized)', function () {
        expect(response.statusCode).toEqual(401);
      });
    });
  });

  describe('[mode=attachment][bucket|key as string][contentType as function][no filename]', function () {
    before('define route without filename', function () {
      return server.route({
        method: 'GET',
        path: '/files2/{path*}',
        handler: {
          s3: {
            s3Params: {
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            // force mode to `attachment`
            mode: 'attachment',
            bucket: 'test', // fixed bucket
            key: 'files2', // used as prefix
            // define content type based on key
            contentType: (request, { /* bucket, */ key, contentType }) => {
              if (key.match(/\.pdf$/)) {
                return 'application/pdf';
              }

              return contentType;
            }
          }
        }
      });
    });

    describe('valid request', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files2/1.pdf'
        };
        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 200 (OK)', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should set the dynamically created content-type header', function () {
        expect(response.headers['content-type']).toEqual('application/pdf');
      });

      it('should use `mode=attachment` and `filename=basename(key)` as the correct content-disposition', function () {
        expect(response.headers['content-disposition']).toEqual('attachment; filename="1.pdf"');
      });

      it('should respond with the content of the s3 file', function () {
        expect(response.payload).toEqual('test2\ntest2\ntest2\ntest2\n');
      });
    });

    describe('when file does not exist', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files2/2.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with HTTP 404 (Not Found)', function () {
        expect(response.statusCode).toEqual(404);
      });
    });
  });

  describe('[mode=auto][filename as function]', function () {
    before('define route with mode `auto`', function () {
      return server.route({
        method: 'GET',
        path: '/files3/{path*}',
        handler: {
          s3: {
            s3Params: {
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            // mode auto tries to inherit content-type and content-disposition headers from S3
            mode: 'auto',
            bucket: 'test',
            key: 'files2',
            // prefix existing
            filename: (request, { /* bucket, key, */ filename }) => `xxx${filename}`
          }
        }
      });
    });

    describe('valid request', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files3/1.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 200 (OK)', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should use the content-type provided by s3', function () {
        expect(response.headers['content-type']).toEqual('application/octet-stream');
      });

      it('should use the content-disposition provided by s3 and extend it', function () {
        expect(response.headers['content-disposition']).toEqual('attachment; filename="xxxtest-1.pdf"');
      });

      it('should respond with the content of the s3 file', function () {
        expect(response.payload).toEqual('test2\ntest2\ntest2\ntest2\n');
      });
    });
  });

  describe('[mode=false]', function () {
    before('define route with mode `false`', function () {
      return server.route({
        method: 'GET',
        path: '/files4/{path*}',
        handler: {
          s3: {
            s3Params: {
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            // mode false disables content-dispostion
            mode: false,
            bucket: 'test',
            key: 'files2'
          }
        }
      });
    });

    describe('valid request', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files4/1.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with 200 (OK)', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should use the content-type header provided by s3', function () {
        expect(response.headers['content-type']).toEqual('application/octet-stream');
      });

      it('should not have a content-disposition header', function () {
        expect(response.headers['content-disposition']).toNotExist();
      });

      it('should respond with the content of the s3 file', function () {
        expect(response.payload).toEqual('test2\ntest2\ntest2\ntest2\n');
      });
    });
  });

  describe('[onResponse]', function () {
    let onResponseError;

    before('define route', function () {
      return server.route({
        method: 'GET',
        path: '/files5/{path*}',
        handler: {
          s3: {
            s3Params: {
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            key: 'files2',
            onResponse(...args) {
              const [err, res, request, reply, options] = args; // eslint-disable-line no-unused-vars

              const { error } = Joi.validate(args, Schemas.onResponseParamsSchema.get);
              onResponseError = error;

              if (err) {
                return reply({ message: 'there was an error' });
              }

              // update `res`
              const chunks = [];
              res.on('data', (data) => chunks.push(data));
              return res.on('end', () => {
                const data = Buffer.concat(chunks).toString('utf8');

                const response = reply(`${data}MOREMORE\n`);

                // pass content type + // don't pass content dispostion
                response.type(options.contentType);
              });
            }
          }
        }
      });
    });

    describe('valid request', function () {
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files5/1.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should call `onResponse` with the correct schema', function () {
        expect(onResponseError).toNotExist();
      });

      it('should respond with the intercepted statusCode', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should respond with the intercepted content-type header', function () {
        expect(response.headers['content-type']).toEqual('application/octet-stream');
      });

      it('should respond with the intercepted content-disposition header', function () {
        expect(response.headers['content-disposition']).toNotExist();
      });

      it('should respond with the intercepted payload', function () {
        expect(response.payload).toEqual('test2\ntest2\ntest2\ntest2\nMOREMORE\n');
      });
    });

    describe('bad request', function () {
      let response;

      before('fetch non-existing file', function () {
        const params = {
          method: 'GET',
          url: '/files5/1000.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should call `onResponse` with the correct schema', function () {
        expect(onResponseError).toNotExist();
      });

      it('should respond with the intercepted statusCode', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should respond with the intercepted content-type header', function () {
        expect(response.headers['content-type']).toEqual('application/json; charset=utf-8');
      });

      it('should respond with the intercepted content-disposition header', function () {
        expect(response.headers['content-disposition']).toNotExist();
      });

      it('should respond with the intercepted payload', function () {
        const payload = JSON.parse(response.payload);

        expect(payload).toEqual({ message: 'there was an error' });
      });
    });
  });

  describe('multi-level paths', function () {
    before('define route', function () {
      return server.route({
        method: 'GET',
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
      let response;

      before('call test route', function () {
        const params = {
          method: 'GET',
          url: '/files6/deeper/3.pdf'
        };

        return server.inject(params)
          .then((res) => {
            response = res;
          });
      });

      it('should respond with HTTP 200 (OK)', function () {
        expect(response.statusCode).toEqual(200);
      });

      it('should respond with the correct file', function () {
        expect(response.payload).toEqual('test3\ntest3\ntest3\ntest3\n');
      });
    });
  });
});

/* eslint prefer-arrow-callback: 0 */

const Path = require('path');

const AWS = require('aws-sdk');
const Hapi = require('hapi');
const RimRaf = require('rimraf');
const S3rver = require('s3rver');
const expect = require('expect');

const Helpers = require('./helpers');
const HapiServeS3 = require('../src');

process.env.AWS_ACCESS_KEY_ID = 'FAKE';
process.env.AWS_SECRET_ACCESS_KEY = 'FAKE';

describe('[integration/serve] "DELETE" spec', function () {
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

  describe('simple setup', function () {
    before('define a test route', function () {
      return server.route({
        method: ['GET', 'POST', 'DELETE'],
        path: '/files/{path?}',
        handler: {
          s3: {
            s3Params: { // these options are just for testing purpose
              s3ForcePathStyle: true,
              endpoint: new AWS.Endpoint('http://localhost:4569')
            },
            bucket: 'test',
            key: 'files3' // prefix
          }
        }
      });
    });

    // upload/prepare file
    const content = Buffer.from('123\nTest PDF\nxxx');
    const files = [
      { name: 'test', buf: content, filename: 'test-NF.pdf' }
    ];

    before('get form data', function () {
      return Helpers.getFormData(files)
        .then((data) => {
          this.formData = data;
        });
    });

    before('upload file via form data', function () {
      const { payload, form } = this.formData;

      const params = {
        method: 'POST',
        url: '/files/',
        headers: form.getHeaders(),
        payload
      };

      return server.inject(params)
        .then((res) => {
          expect(res.statusCode).toEqual(201);
        });
    });

    after('cleanup files', function () {
      RimRaf.sync(Path.resolve(__dirname, './fixtures/buckets/test/files3'));
    });

    describe('deleting an existing item', function () {
      let response;
      let getResponse;

      before('call api', function () {
        const params = {
          method: 'DELETE',
          url: '/files/test-NF.pdf'
        };

        return server.inject(params)
          .then((resp) => {
            response = resp;
          });
      });

      before('reload files', function () {
        const params = {
          method: 'GET',
          url: '/files/test-NF.pdf'
        };

        return server.inject(params)
          .then((resp) => {
            getResponse = resp;
          });
      });

      it('should respond with HTTP 204 (No Content)', function () {
        expect(response.statusCode).toEqual(204);
      });

      it('should not be possible to load the files again', function () {
        expect(getResponse.statusCode).toEqual(404);
      });
    });
  });
});

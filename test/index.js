import S3rver from 's3rver';
import AWS from 'aws-sdk';
import path from 'path';
import Boom from 'boom';
import Hapi from 'hapi';
import Joi from 'joi';
import chai from 'chai';
const expect = chai.expect;

import hapiServeS3 from '../src';


describe('hapi integration', () => {
  let server;

  before('create a mocked s3 server', (done) => {
    new S3rver({
      port: 4569,
      hostname: 'localhost',
      silent: true,
      directory: path.join(__dirname, './fixtures/buckets'),
    })
    .run(done);
  });

  before('load hapi server with serve-s3 plugin', () => {
    server = new Hapi.Server();
    server.connection({ port: 8888 });

    return server.register({
      register: hapiServeS3,
      options: { },
    });
  });

  before('define a test route', () => { // eslint-disable-line arrow-body-style
    return server.route({
      method: 'GET',
      path: '/files/{filename}.pdf',
      handler: {
        s3: {
          s3Params: { // these options are just for testing purpose
            s3ForcePathStyle: true,
            endpoint: new AWS.Endpoint('http://localhost:4569'),
          },
          mode: 'attachment',
          bucket(request) {
            const { pre: { authorizedPath } } = request;

            return authorizedPath.split('/').shift();
          },
          key(request) {
            const { pre: { authorizedPath } } = request;

            return authorizedPath.split('/').slice(1).join('/');
          },
          filename(request) {
            return `${request.params.filename}.pdf`;
          },
          overrideContentTypes: {
            'application/octet-stream': 'application/pdf',
          },
        },
      },
      config: {
        pre: [{
          assign: 'authorizedPath',
          method(request, reply) {
            const { params: { filename } } = request;

            if (filename !== '1') {
              return reply(Boom.unauthorized('filename is not valid'));
            }

            return reply('test/files/1.pdf');
          },
        }],
        validate: {
          params: {
            filename: Joi.string().required(),
          },
        },
      },
    });
  });

  describe('calling a valid route', () => {
    let response;

    before('call test route', () => { // eslint-disable-line arrow-body-style
      return server.inject({
        method: 'GET',
        url: '/files/1.pdf',
      })
      .then((res) => {
        response = res;
      });
    });

    it('should respond with 200 (OK)', () => {
      expect(response.statusCode).to.equal(200);
    });

    it('should set the correct content-type headers', () => {
      expect(response.headers['content-type']).to.equal('application/pdf');
    });

    it('should set the correct content-disposition headers', () => {
      expect(response.headers['content-disposition']).to.equal('attachment; filename=1.pdf');
    });

    it('should respond with the content of the s3 file', () => {
      expect(response.payload).to.equal('test\ntest\ntest\ntest\n');
    });
  });

  describe('calling an ivalid route', () => {
    let response;

    before('call test route', () => { // eslint-disable-line arrow-body-style
      return server.inject({
        method: 'GET',
        url: '/files/2.pdf',
      })
      .then((res) => {
        response = res;
      });
    });

    it('should respond with 401 (Unauthorized)', () => {
      expect(response.statusCode).to.equal(401);
    });
  });
});

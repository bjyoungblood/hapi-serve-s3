const Path = require('path');

const S3rver = require('s3rver');
const AWS = require('aws-sdk');
const Boom = require('boom');
const Hapi = require('hapi');
const Joi = require('joi');
const Chai = require('chai');

const hapiServeS3 = require('../src');

const expect = Chai.expect;

process.env.AWS_ACCESS_KEY_ID = 'FAKE';
process.env.AWS_SECRET_ACCESS_KEY = 'FAKE';

describe('hapi integration', () => {
  let server;

  before('create a mocked s3 server', (done) => {
    const params = {
      port: 4569,
      hostname: 'localhost',
      silent: true,
      directory: Path.join(__dirname, './fixtures/buckets')
    };

    new S3rver(params).run(done);
  });

  before('load hapi server with serve-s3 plugin', () => {
    server = new Hapi.Server();
    server.connection({ port: 8888 });

    return server.register({
      register: hapiServeS3,
      options: {}
    });
  });

  before('define a test route', () => {
    return server.route({
      method: 'GET',
      path: '/files/{filename}.pdf',
      handler: {
        s3: {
          s3Params: { // these options are just for testing purpose
            s3ForcePathStyle: true,
            endpoint: new AWS.Endpoint('http://localhost:4569')
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
            'application/octet-stream': 'application/pdf'
          }
        }
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

  before('define route without filename', () => { // eslint-disable-line arrow-body-style
    return server.route({
      method: 'GET',
      path: '/files2/{path*}',
      handler: {
        s3: {
          s3Params: { // these options are just for testing purpose
            s3ForcePathStyle: true,
            endpoint: new AWS.Endpoint('http://localhost:4569')
          },
          mode: 'attachment',
          bucket: 'test',
          key: 'files2' // used as prefix
        }
      }
    });
  });

  describe('calling route where key, bucket and filename are functions', () => {
    let response;

    before('call test route', () => { // eslint-disable-line arrow-body-style
      return server.inject({
        method: 'GET',
        url: '/files/1.pdf'
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
      expect(response.headers['content-disposition']).to.equal('attachment; filename="1.pdf"');
    });

    it('should respond with the content of the s3 file', () => {
      expect(response.payload).to.equal('test\ntest\ntest\ntest\n');
    });
  });

  describe('test custom validation pre handler', () => {
    let response;

    before('call test route', () => { // eslint-disable-line arrow-body-style
      return server.inject({
        method: 'GET',
        url: '/files/2.pdf'
      })
      .then((res) => {
        response = res;
      });
    });

    it('should respond with 401 (Unauthorized)', () => {
      expect(response.statusCode).to.equal(401);
    });
  });

  describe('calling route where key and bucket are strings and filename is not defined', () => {
    let response;

    before('call test route', () => { // eslint-disable-line arrow-body-style
      return server.inject({
        method: 'GET',
        url: '/files2/1.pdf'
      })
      .then((res) => {
        response = res;
      });
    });

    it('should respond with 200 (OK)', () => {
      expect(response.statusCode).to.equal(200);
    });

    it('should set the correct content-disposition headers', () => {
      expect(response.headers['content-disposition']).to.equal('attachment; filename="1.pdf"');
    });

    it('should respond with the content of the s3 file', () => {
      expect(response.payload).to.equal('test\ntest\ntest\ntest\n');
    });
  });
});

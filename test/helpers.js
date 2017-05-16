const Path = require('path');
const Stream = require('stream');

const FormData = require('form-data');

const Helpers = exports;


/**
 * Transform a list of file definitions to a FormData object
 *
 * @param {Array<Object<{ name, buf, filename }>>} files
 * @resolves {Object<{ payload: Buffer, form: FormData }>}
 */
Helpers.getFormData = function (files) {

  const converter = new Stream.Writable();
  const data = [];
  converter._write = function (chunk, encoding, callback) { // eslint-disable-line no-underscore-dangle
    data.push(chunk);
    callback();
  };

  const form = new FormData();
  files.forEach(({ name, buf, filename }) => {
    form.append(name, buf, filename);
  });

  form.pipe(converter);

  return new Promise((resolve, reject) => {
    converter.on('error', reject);
    converter.on('finish', () => {
      return resolve({ payload: Buffer.concat(data), form });
    });
  });
};


/**
 * Reload files from the server using the 'GET' route
 */
Helpers.reloadFiles = function (files, { server, prefix }) {

  const responses = {};
  const calls = files.reduce((memo, file) => {
    const filename = file.filename || file.name;

    return Object.assign(memo, {
      [file.name]: {
        method: 'GET',
        url: Path.join(prefix, filename)
      }
    });
  }, {});

  const promises = Object.keys(calls)
    .map((name) => {
      const call = calls[name];

      return server.inject(call)
        .then((resp) => {
          responses[name] = resp;
        });
    });

  return Promise.all(promises)
    .then(() => responses);
};

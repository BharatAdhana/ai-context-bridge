'use strict';

const express = require('express');
const { createRoutes } = require('./routes');

async function startServer(options) {
  const settings = Object.assign(
    {
      port: 3333,
      projectRoot: process.cwd(),
      logger: null
    },
    options
  );
  const app = express();

  app.disable('x-powered-by');
  app.use(createRoutes(settings.projectRoot, settings.logger));

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(settings.port, () => resolve(instance));
    instance.on('error', reject);
  });

  return {
    app,
    server,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

module.exports = {
  startServer
};

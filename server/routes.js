'use strict';

const path = require('path');
const express = require('express');
const { getContextPaths } = require('../core/stateManager');

function createRoutes(projectRoot, logger) {
  const router = express.Router();
  const paths = getContextPaths(projectRoot);

  function sendFile(filePath, contentType) {
    return function routeHandler(request, response) {
      response.type(contentType);
      response.sendFile(
        path.resolve(filePath),
        {
          dotfiles: 'allow'
        },
        (error) => {
          if (!error) {
            return;
          }

          if (logger) {
            logger.error(`Failed to serve ${request.path}: ${error.message}`);
          }

          if (response.headersSent) {
            return;
          }

          response.status(error.statusCode || 500).json({
            error: 'Unable to read AI context file.'
          });
        }
      );
    };
  }

  router.get('/state.json', sendFile(paths.stateFile, 'application/json'));
  router.get('/brain.txt', sendFile(paths.brainFile, 'text/plain'));
  router.get('/context.md', sendFile(paths.contextFile, 'text/markdown'));
  router.get('/changelog.json', sendFile(paths.changelogFile, 'application/json'));

  return router;
}

module.exports = {
  createRoutes
};

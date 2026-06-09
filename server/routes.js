'use strict';

const path    = require('path');
const express = require('express');
const { getContextPaths } = require('../core/stateManager');

function createRoutes(projectRoot, logger) {
  const router = express.Router();
  const paths  = getContextPaths(projectRoot);

  function sendFile(filePath, contentType) {
    return function routeHandler(req, res) {
      res.type(contentType);
      res.sendFile(path.resolve(filePath), { dotfiles: 'allow' }, (err) => {
        if (!err) return;
        if (logger) logger.error(`Failed to serve ${req.path}: ${err.message}`);
        if (res.headersSent) return;
        res.status(err.statusCode || 500).json({ error: 'Unable to read AI context file.' });
      });
    };
  }

  router.get('/state.json',    sendFile(paths.stateFile,     'application/json'));
  router.get('/brain.txt',     sendFile(paths.brainFile,     'text/plain'));
  router.get('/context.md',    sendFile(paths.contextFile,   'text/markdown'));
  router.get('/changelog.json',sendFile(paths.changelogFile, 'application/json'));
  router.get('/briefing.md',   sendFile(paths.briefingFile,  'text/markdown'));

  // Convenience root — lists all available endpoints
  router.get('/', (req, res) => {
    res.json({
      project:   require('../core/stateManager').detectProjectMetadata(projectRoot).project,
      endpoints: {
        briefing:  '/briefing.md   – Full AI briefing (paste into any AI)',
        state:     '/state.json    – Machine-readable full state',
        changelog: '/changelog.json – Code change history with diffs',
        brain:     '/brain.txt     – AI instructions',
        context:   '/context.md    – Human-readable project summary'
      }
    });
  });

  return router;
}

module.exports = { createRoutes };
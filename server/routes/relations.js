/*
 * Political Society Argument & Source Database
 * -------------------------------------------------
 * Author:   BEN GREEN
 * GitHub:   https://github.com/fwl517/Argument-Registry
 * Licence:  CC0
 */
'use strict';

const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

const router = express.Router();

// Relations are directional A -> B rows in argument_relations. The inverse is
// derived at query time (see routes/entries.js buildRelations), so deleting the
// single stored row removes the relationship in both directions.
//
// DELETE /api/relations/:id  (Admin or Root)
router.delete(
  '/:id',
  requirePermission('Admin'),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(404, 'NOT_FOUND');
    }

    const result = await db.query(
      'DELETE FROM argument_relations WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, 'NOT_FOUND');
    }

    res.status(204).end();
  })
);

module.exports = router;

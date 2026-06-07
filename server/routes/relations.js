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
const { requirePermission, sameScope } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

const router = express.Router();

// Relations are directional A -> B rows in argument_relations. The inverse is
// derived at query time (see routes/entries.js buildRelations), so deleting the
// single stored row removes the relationship in both directions.
//
// DELETE /api/relations/:id  (Admin within scope, or any home-group Admin)
//
// Scope: an admin can delete a relation if they have admin reach over the
// user who created it. Foreign-imported relations (created_by = NULL) can
// only be deleted by home-group admins.
router.delete(
  '/:id',
  requirePermission('Admin'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new HttpError(404, 'NOT_FOUND');
    }

    let creatorRow = null;
    try {
      const { rows } = await db.query(
        `SELECT ar.created_by, u.group_id
           FROM argument_relations ar
           LEFT JOIN users u ON u.id = ar.created_by
          WHERE ar.id = $1`,
        [id]
      );
      creatorRow = rows[0] || null;
    } catch {
      throw new HttpError(404, 'NOT_FOUND'); // malformed uuid
    }
    if (!creatorRow) throw new HttpError(404, 'NOT_FOUND');

    if (creatorRow.created_by) {
      if (!sameScope(req.user, { group_id: creatorRow.group_id })) {
        throw new HttpError(403, 'PERMISSION_DENIED');
      }
    } else if (!req.user.is_home_group) {
      // Foreign-imported relation — home admins only.
      throw new HttpError(403, 'PERMISSION_DENIED');
    }

    const result = await db.query(
      'DELETE FROM argument_relations WHERE id = $1',
      [id]
    );
    if (result.rowCount === 0) throw new HttpError(404, 'NOT_FOUND');
    res.status(204).end();
  })
);

module.exports = router;

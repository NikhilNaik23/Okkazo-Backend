const express = require('express');
const eventTodoController = require('../controllers/eventTodoController');
const { authorizeRoles } = require('../middleware/authorization');

const router = express.Router();

router.get(
  '/todo/:eventId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  eventTodoController.listEventTodos
);

router.post(
  '/todo/:eventId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  eventTodoController.createEventTodo
);

router.patch(
  '/todo/:eventId/:todoId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  eventTodoController.updateEventTodo
);

router.delete(
  '/todo/:eventId/:todoId',
  authorizeRoles(['USER', 'VENDOR', 'ADMIN', 'MANAGER']),
  eventTodoController.deleteEventTodo
);

module.exports = router;
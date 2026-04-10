const logger = require('../utils/logger');
const eventTodoService = require('../services/eventTodoService');

const listEventTodos = async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await eventTodoService.listEventTodos({
      eventId,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Error in listEventTodos:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch event to-do items',
    });
  }
};

const createEventTodo = async (req, res) => {
  try {
    const { eventId } = req.params;
    const task = await eventTodoService.createEventTodo({
      eventId,
      user: req.user,
      payload: req.body,
    });

    return res.status(201).json({
      success: true,
      message: 'To-do item created',
      data: { task },
    });
  } catch (error) {
    logger.error('Error in createEventTodo:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to create event to-do item',
    });
  }
};

const updateEventTodo = async (req, res) => {
  try {
    const { eventId, todoId } = req.params;
    const task = await eventTodoService.updateEventTodo({
      eventId,
      todoId,
      user: req.user,
      payload: req.body,
    });

    return res.status(200).json({
      success: true,
      message: 'To-do item updated',
      data: { task },
    });
  } catch (error) {
    logger.error('Error in updateEventTodo:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to update event to-do item',
    });
  }
};

const deleteEventTodo = async (req, res) => {
  try {
    const { eventId, todoId } = req.params;
    await eventTodoService.deleteEventTodo({
      eventId,
      todoId,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      message: 'To-do item deleted',
    });
  } catch (error) {
    logger.error('Error in deleteEventTodo:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to delete event to-do item',
    });
  }
};

module.exports = {
  listEventTodos,
  createEventTodo,
  updateEventTodo,
  deleteEventTodo,
};
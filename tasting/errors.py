"""Tasting errors the routes map to HTTP answers.

Both are ``HTTPException`` subclasses so ``utils.handle_db_errors`` re-raises
them untouched (it would otherwise turn them into a generic 500) and Flask
renders the JSON body below.
"""
from flask import jsonify
from werkzeug.exceptions import HTTPException

from extensions import db


class TastingValidationError(HTTPException):
    """A bad field in a request body: 400 ``{error, field}``."""
    code = 400

    def __init__(self, field: str, message: str):
        super().__init__(description=message)
        self.field = field
        self.message = message

    def get_response(self, environ=None, scope=None):
        db.session.rollback()
        response = jsonify({"error": self.message, "field": self.field})
        response.status_code = 400
        return response


class TastingStateError(HTTPException):
    """A refusal the route maps to 409: ``code`` is the body's ``error`` value."""
    code = 409

    def __init__(self, error: str, message: str):
        super().__init__(description=message)
        self.error = error
        self.message = message

    def get_response(self, environ=None, scope=None):
        db.session.rollback()
        response = jsonify({"error": self.error, "message": self.message})
        response.status_code = 409
        return response

"""
Clarity Mesh — Shared Rate Limiter Instance
===========================================
A single slowapi ``Limiter`` shared by ``main.py`` (to attach to
``app.state.limiter``) and by the route modules (to decorate sensitive
endpoints with ``@limiter.limit(...)``).

Keeping the limiter in its own import-graph leaf avoids a circular import:
``main`` imports the routers, and the routers need the *same* limiter
instance that is registered on the app, otherwise the per-route decorators
would be attached to a throwaway object and never enforced.

The limiter is enabled by default and disabled in the test suite via the
``CLARITY_RATE_LIMIT_ENABLED=false`` environment variable (see conftest).
"""

from __future__ import annotations

import os

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["180/minute"],
    enabled=os.getenv("CLARITY_RATE_LIMIT_ENABLED", "true").lower() != "false",
)
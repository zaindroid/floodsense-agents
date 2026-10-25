"""Run the agents service with the console's pages on top.

    python -m console              # http://127.0.0.1:8100
"""

from __future__ import annotations

import console.app  # noqa: F401 - importing it registers the console's routes
from floodsense_agents.__main__ import app
from floodsense_agents.settings import settings


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()

import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from app.database import Base
from app.models import ClusterTelemetryLog, User


config = context.config


# Read DATABASE_URL from the environment.
database_url = os.getenv("DATABASE_URL")

if database_url:
    database_url = database_url.replace(
        "postgresql://",
        "postgresql+psycopg2://",
        1,
    )

    config.set_main_option(
        "sqlalchemy.url",
        database_url.replace("%", "%%"),
    )


if config.config_file_name is not None:
    fileConfig(config.config_file_name)


# Tell Alembic about our SQLAlchemy models.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in offline mode."""

    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={
            "paramstyle": "named",
        },
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in online mode."""

    connectable = engine_from_config(
        config.get_section(
            config.config_ini_section,
            {},
        ),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

# ADR 0001 — Modular monolith

- Status: Accepted
- Date: 2026-11-15

## Context

The MVP team is small, and the domain (marketplace, applications, matching, offers, documents, transactions, billing) is still being validated with pilot partners.

## Decision

One NestJS application with one module per domain (M0–M9), one PostgreSQL database and one worker process for background jobs. Modules own their tables and talk to each other through service interfaces and domain events (in-process emitter plus an outbox table). They never query each other's tables directly.

## Consequences

- One deployment, one migration path, simple local development.
- Clear seams: a module can be extracted into a service later if volume requires it.
- Cross-module discipline must be enforced in code review, because the compiler will not prevent a module from importing another module's repository.

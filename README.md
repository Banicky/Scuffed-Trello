# Scuffed-Trello
Real-Time Collaborative Task Board (like a mini Trello)

React/Next.js frontend with WebSockets for live updates
Node.js or FastAPI backend with REST + WebSocket APIs
Postgres for tasks/users, Redis for session caching and pub/sub
JWT-based auth with OAuth (Google login)
Dockerized services, deployed on AWS (ECS, RDS, ElastiCache)
SQS for async notifications (email on task assignment)
GitHub Actions CI/CD pipeline
Prometheus/Grafana for monitoring
Nginx as reverse proxy/load balancer
Kubernetes if you want to scale workers independently
Terraform to define the infra

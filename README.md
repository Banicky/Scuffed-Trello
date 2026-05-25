# Tech Stack

React/Next.js frontend — The UI where users see boards, lists, and cards. Next.js gives you server-side rendering for fast initial loads and file-based routing. WebSocket connections let every user see card moves/edits in real time without refreshing.

Node.js or FastAPI backend — Handles API requests: creating boards, moving cards, assigning users, etc. Exposes REST endpoints for CRUD operations and maintains WebSocket connections to push live updates to connected clients.

Postgres — Primary database. Stores users, boards, lists, cards, comments, and assignments. Relational structure works well here because cards belong to lists, lists belong to boards, and users have many-to-many relationships with boards.

Redis — Two roles. First, caching frequently accessed data like board state so you're not hitting Postgres on every page load. Second, pub/sub — when one server instance receives a card update, it publishes to Redis so all other server instances can push the update to their connected WebSocket clients.

JWT + OAuth — JWT tokens authenticate API requests without server-side session storage. OAuth lets users "Sign in with Google" instead of managing passwords yourself. The backend issues a JWT after successful OAuth, and the frontend includes it in every subsequent request.

Docker — Packages the frontend, backend, Redis, and Postgres into containers with consistent environments. Docker Compose lets you spin up the whole stack locally with one command. Eliminates "works on my machine" issues.

AWS (ECS, RDS, ElastiCache) — ECS runs your Docker containers in production. RDS is managed Postgres (handles backups, failover). ElastiCache is managed Redis. You avoid manually maintaining servers.

SQS — When a user is assigned a card, the backend drops a message onto the queue rather than sending an email synchronously. A separate worker process consumes the queue and sends the email. This keeps API responses fast and decouples notification logic from the main app.

GitHub Actions CI/CD — On every push to main, automatically runs tests, builds Docker images, pushes them to a container registry, and deploys to ECS. No manual deploys.

Prometheus/Grafana — Prometheus scrapes metrics from your services (request latency, error rates, queue depth, CPU usage). Grafana visualizes them in dashboards and triggers alerts if something looks wrong (e.g., error rate spikes above 5%).

Nginx — Sits in front of your backend instances. Terminates TLS, distributes requests across multiple backend containers, and serves static assets. Single entry point to your system.

Kubernetes — Orchestrates your containers at scale. Auto-scales backend instances based on CPU/traffic, restarts crashed containers, and lets you deploy with zero downtime via rolling updates. Overkill for small projects but valuable to learn.

Terraform — Defines all the AWS resources (ECS cluster, RDS instance, load balancer, VPC, security groups) as code in .tf files. You run terraform apply and it provisions everything reproducibly, rather than clicking through the AWS console.

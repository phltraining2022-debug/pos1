# kube/ — Hello World Express on Kubernetes

This folder contains a minimal Node/Express "Hello World" app and Kubernetes manifests plus a small deploy script that uses a kubeconfig file named `live1-kubeconfig.yaml` (expected to be at the workspace root or specify a path).

What you'll find:

- `app/` - minimal Express app
- `Dockerfile` - builds the app image
- `deployment.yaml` - Kubernetes Deployment manifest
- `service.yaml` - Kubernetes Service manifest (ClusterIP)
- `deploy.sh` - helper script: build, push and `kubectl apply` using `live1-kubeconfig.yaml`
- `.dockerignore`

Quick deploy steps (from workspace root):

1. Configure variables and kubeconfig location (edit `deploy.sh` or set env vars):

   - DOCKER_REPO: the image repository (e.g. `docker.io/<user>` or your registry)
   - IMAGE_TAG: optional tag (default: `latest`)
   - KUBECONFIG: by default the script uses `live1-kubeconfig.yaml` in the workspace root; set `KUBECONFIG` env var to override

2. Build, push and apply:

```bash
cd kube
./deploy.sh
```

3. Verify:

```bash
# check pods
KUBECONFIG=${KUBECONFIG:-../live1-kubeconfig.yaml} kubectl get pods -n hello
# get service
KUBECONFIG=${KUBECONFIG:-../live1-kubeconfig.yaml} kubectl get svc -n hello
```

Notes:
- The script assumes you can `docker push` to the `DOCKER_REPO`. It does not configure authentication for registries.
- If you prefer to build locally and load into a cluster (kind/minikube), adapt the script accordingly.

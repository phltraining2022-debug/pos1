#!/usr/bin/env bash
set -euo pipefail

# deploy.sh - build, push and kubectl apply using live1-kubeconfig.yaml (or KUBECONFIG env var)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Configuration (can be set via env)
DOCKER_REPO=${DOCKER_REPO:-your-docker-repo}
IMAGE_NAME=${IMAGE_NAME:-hello-kube}
IMAGE_TAG=${IMAGE_TAG:-latest}
IMAGE="$DOCKER_REPO/$IMAGE_NAME:$IMAGE_TAG"

# kubeconfig file to use (default: workspace root live1-kubeconfig.yaml)
KUBECONFIG_PATH=${KUBECONFIG:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/live1-kubeconfig.yaml"}

if [ -z "$DOCKER_REPO" ] || [ "$DOCKER_REPO" = "your-docker-repo" ]; then
  echo "ERROR: set DOCKER_REPO environment variable to a pushable registry (e.g. docker.io/youruser)"
  exit 1
fi

echo "Building Docker image: $IMAGE"

# Prefer docker buildx (multi-platform) when available. Build for linux/amd64 which is the common k8s node arch.
PUSHED=0
if command -v docker >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1; then
  echo "docker buildx available — building for linux/amd64 and pushing"
  # buildx can push directly; this ensures the image manifest includes the requested platform
  docker buildx build --platform linux/amd64 -t "$IMAGE" --push .
  PUSHED=1
else
  echo "docker buildx not available — attempting docker build for linux/amd64 (may require Docker >=19.03)"
  docker build --platform linux/amd64 -t "$IMAGE" .
  echo "Pushing image: $IMAGE"
  docker push "$IMAGE"
  PUSHED=1
fi

# If docker is available, do a quick manifest check to ensure linux/amd64 is present
if [ "$PUSHED" -eq 1 ] && command -v docker >/dev/null 2>&1; then
  echo "Inspecting image manifest for linux/amd64 support"
  if docker manifest inspect "$IMAGE" >/dev/null 2>&1; then
    if docker manifest inspect "$IMAGE" | grep -q '"architecture"\s*:\s*"amd64"'; then
      echo "OK: image manifest contains linux/amd64"
    else
      echo "ERROR: image manifest does NOT contain linux/amd64. This will cause exec format errors on amd64 nodes."
      echo "Try rebuilding with buildx for linux/amd64:"
      echo "  docker buildx build --platform linux/amd64 -t $IMAGE --push ."
      exit 1
    fi
  else
    echo "Warning: unable to inspect image manifest (docker manifest inspect failed). Ensure the image was pushed to the registry and is accessible." 
  fi
fi

# Ensure the kubeconfig file exists before exporting it. If it's missing, fail with a clear message
if [ -f "$KUBECONFIG_PATH" ]; then
  export KUBECONFIG="$KUBECONFIG_PATH"
  echo "Using KUBECONFIG=$KUBECONFIG"
else
  echo "ERROR: kubeconfig not found at: $KUBECONFIG_PATH"
  echo "Please provide a valid kubeconfig file or set the KUBECONFIG env var to a file that exists."
  echo "If you intended to use your current kubectl context, unset KUBECONFIG before running this script."
  exit 1
fi

echo "Creating namespace 'hello' if missing"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: hello
EOF


echo "Applying deployment and service (image=$IMAGE)"

# Validate image name (no spaces)
if echo "$IMAGE" | grep -q '[[:space:]]'; then
  echo "ERROR: computed image name contains whitespace: '$IMAGE'"
  exit 1
fi

# Replace placeholder __IMAGE__ in deployment.yaml with the computed image and apply
sed "s#__IMAGE__#${IMAGE}#g" deployment.yaml | kubectl apply -f -

kubectl apply -f service.yaml

echo "Deployment applied. Check pods: kubectl get pods -n hello"

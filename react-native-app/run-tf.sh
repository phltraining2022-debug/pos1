#!/bin/zsh
set -euo pipefail

# One-command iOS TestFlight pipeline for KaraPOSMobile:
# 1) Optional build number bump
# 2) pod install
# 3) Archive
# 4) Export + upload to App Store Connect (fallback: export IPA)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
IOS_DIR="$PROJECT_DIR/ios"
INFO_PLIST="$IOS_DIR/KaraPOSMobile/Info.plist"
ARCHIVE_PATH="$PROJECT_DIR/build/KaraPOSMobile.xcarchive"
LOG_DIR="$PROJECT_DIR/build/tf-logs"
EXPORT_DIR="$PROJECT_DIR/build/export-upload"
EXPORT_OPTIONS_PLIST="/tmp/karapos-export-upload.plist"
EXPORT_OPTIONS_PLIST_IPA="/tmp/karapos-export-ipa.plist"
SCHEME="KaraPOSMobile"
WORKSPACE="KaraPOSMobile.xcworkspace"
TEAM_ID="B94C8QTSJ8"
BUNDLE_ID="vn.vvs.pos1"

INCREMENT_BUILD="false"
CUSTOM_BUILD_NUMBER=""
SKIP_POD_INSTALL="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --increment-build)
      INCREMENT_BUILD="true"
      shift
      ;;
    --build-number)
      CUSTOM_BUILD_NUMBER="${2:-}"
      if [[ -z "$CUSTOM_BUILD_NUMBER" ]]; then
        echo "Missing value for --build-number"
        exit 1
      fi
      shift 2
      ;;
    --skip-pod-install|--no-pod-install)
      SKIP_POD_INSTALL="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: ./run-tf.sh [--increment-build] [--build-number N] [--skip-pod-install]"
      exit 1
      ;;
  esac
done

if [[ "$INCREMENT_BUILD" == "true" && -n "$CUSTOM_BUILD_NUMBER" ]]; then
  echo "Use either --increment-build or --build-number, not both."
  exit 1
fi

if [[ ! -f "$INFO_PLIST" ]]; then
  echo "Info.plist not found: $INFO_PLIST"
  exit 1
fi

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not available. Install Xcode command line tools."
  exit 1
fi

if ! security find-identity -v -p codesigning | grep -q "Apple Distribution"; then
  echo "No Apple Distribution certificate found in Keychain."
  exit 1
fi

# Sets PRODUCTION_PROFILE_UUID to the newest local profile for $BUNDLE_ID
# that has aps-environment=production and get-task-allow=false.
find_production_push_profile_uuid() {
  local profile_dir="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
  local best_uuid=""
  local best_mtime=0
  local report=""

  if [[ ! -d "$profile_dir" ]]; then
    return 1
  fi

  for profile in "$profile_dir"/*.mobileprovision; do
    [[ -f "$profile" ]] || continue

    local plist_tmp
    plist_tmp="$(mktemp /tmp/karapos-profile-check.XXXXXX.plist)"
    if ! security cms -D -i "$profile" > "$plist_tmp" 2>/dev/null; then
      rm -f "$plist_tmp"; continue
    fi

    local app_id
    app_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$plist_tmp" 2>/dev/null || true)"
    if [[ "$app_id" == "$TEAM_ID.$BUNDLE_ID" ]]; then
      local name aps gta uuid mtime
      name="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$plist_tmp" 2>/dev/null || echo '(unknown)')"
      aps="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:aps-environment' "$plist_tmp" 2>/dev/null || echo 'missing')"
      gta="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:get-task-allow' "$plist_tmp" 2>/dev/null || echo 'missing')"
      uuid="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$plist_tmp" 2>/dev/null || echo '')"
      mtime=$(stat -f '%m' "$profile" 2>/dev/null || echo 0)
      report+="- $name | UUID=$uuid | aps=$aps | get-task-allow=$gta\n"

      if [[ "$aps" == "production" && "$gta" == "false" && -n "$uuid" ]]; then
        if (( mtime > best_mtime )); then
          best_mtime=$mtime
          best_uuid="$uuid"
        fi
      fi
    fi

    rm -f "$plist_tmp"
  done

  if [[ -z "$best_uuid" ]]; then
    echo ""
    echo "ERROR: Chưa có local provisioning profile hợp lệ cho TestFlight/App Store."
    echo "Yêu cầu: bundle $BUNDLE_ID phải có aps-environment=production và get-task-allow=false."
    echo ""
    echo "Profile local hiện có:"
    if [[ -n "$report" ]]; then
      printf "%b" "$report"
    else
      echo "- (không tìm thấy profile nào cho $TEAM_ID.$BUNDLE_ID)"
    fi
    echo ""
    echo "Fix nhanh:"
    echo "1) Apple Developer > Identifiers > $BUNDLE_ID: bật Push Notifications"
    echo "2) Regenerate App Store provisioning profile cho $BUNDLE_ID"
    echo "3) Download profile mới về máy/Xcode rồi chạy lại"
    exit 6
  fi

  PRODUCTION_PROFILE_UUID="$best_uuid"
  echo "Production push profile: UUID=$PRODUCTION_PROFILE_UUID"
}

mkdir -p "$LOG_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_LOG="$LOG_DIR/archive-$TIMESTAMP.log"
UPLOAD_LOG="$LOG_DIR/upload-$TIMESTAMP.log"

set_build_number() {
  local new_build="$1"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $new_build" "$INFO_PLIST"
  echo "Set CFBundleVersion=$new_build"
}

if [[ -n "$CUSTOM_BUILD_NUMBER" ]]; then
  set_build_number "$CUSTOM_BUILD_NUMBER"
elif [[ "$INCREMENT_BUILD" == "true" ]]; then
  CURRENT_BUILD="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO_PLIST")"
  if [[ "$CURRENT_BUILD" =~ ^[0-9]+$ ]]; then
    NEXT_BUILD="$((CURRENT_BUILD + 1))"
    set_build_number "$NEXT_BUILD"
  else
    echo "CFBundleVersion is not numeric ($CURRENT_BUILD). Use --build-number N"
    exit 1
  fi
fi

if [[ "$SKIP_POD_INSTALL" != "true" ]]; then
  echo "Running pod install..."
  (cd "$IOS_DIR" && pod install >/dev/null)
fi

PRODUCTION_PROFILE_UUID=""
find_production_push_profile_uuid

cat > "$EXPORT_OPTIONS_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>upload</string>
  <key>generateAppStoreInformation</key>
  <false/>
  <key>manageAppVersionAndBuildNumber</key>
  <true/>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>testFlightInternalTestingOnly</key>
  <false/>
  <key>uploadSymbols</key>
  <false/>
</dict>
</plist>
EOF

cat > "$EXPORT_OPTIONS_PLIST_IPA" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>uploadSymbols</key>
  <false/>
</dict>
</plist>
EOF

echo "Archiving... (log: $ARCHIVE_LOG)"
rm -rf "$ARCHIVE_PATH"
(
  cd "$IOS_DIR"
  xcodebuild archive \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -archivePath "$ARCHIVE_PATH" \
    -destination "generic/platform=iOS" \
    -allowProvisioningUpdates \
    | tee "$ARCHIVE_LOG"
)

APP_BUNDLE_PATH="$ARCHIVE_PATH/Products/Applications/$SCHEME.app"
PROFILE_PATH="$APP_BUNDLE_PATH/embedded.mobileprovision"
PROFILE_PLIST="/tmp/karapos-profile-$TIMESTAMP.plist"
APP_INFO_PLIST="$APP_BUNDLE_PATH/Info.plist"

if [[ -f "$APP_INFO_PLIST" ]]; then
  ENCRYPTION_EXEMPT="$(/usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "$APP_INFO_PLIST" 2>/dev/null || true)"
  if [[ "$ENCRYPTION_EXEMPT" != "false" ]]; then
    echo ""
    echo "ERROR: ITSAppUsesNonExemptEncryption trong app archive không phải 'false'."
    echo "Có thể App Store Connect vẫn yêu cầu khai báo compliance thủ công."
    echo "Fix: đảm bảo key này = false trong ios/KaraPOSMobile/Info.plist rồi build lại."
    exit 3
  fi
fi

if [[ -f "$PROFILE_PATH" ]]; then
  security cms -D -i "$PROFILE_PATH" > "$PROFILE_PLIST"
  APS_ENVIRONMENT="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:aps-environment" "$PROFILE_PLIST" 2>/dev/null || true)"
  PROFILE_NAME="$(/usr/libexec/PlistBuddy -c "Print :Name" "$PROFILE_PLIST" 2>/dev/null || echo "(unknown)")"
  GET_TASK_ALLOW="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:get-task-allow" "$PROFILE_PLIST" 2>/dev/null || echo "(unknown)")"

  echo "Signing profile: $PROFILE_NAME"
  echo "aps-environment: ${APS_ENVIRONMENT:-missing}"
  echo "get-task-allow: $GET_TASK_ALLOW"

  if [[ -z "$APS_ENVIRONMENT" ]]; then
    echo ""
    echo "WARNING: Provisioning profile trong archive thiếu entitlement 'aps-environment'."
    echo "Export step sẽ re-sign với profile production — tiếp tục..."
  elif [[ "$APS_ENVIRONMENT" != "production" ]]; then
    echo ""
    echo "WARNING: Archive có aps-environment='$APS_ENVIRONMENT' — bình thường với Automatic signing."
    echo "Export step sẽ re-sign với iOS Team Store Provisioning Profile (production) — tiếp tục..."
  elif [[ "$GET_TASK_ALLOW" != "false" ]]; then
    echo ""
    echo "WARNING: Archive có get-task-allow=$GET_TASK_ALLOW — export step sẽ re-sign với distribution profile."
  fi
fi

echo ""
echo "Upload to TestFlight... (log: $UPLOAD_LOG)"
mkdir -p "$EXPORT_DIR"
set +e
(
  cd "$IOS_DIR"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
    -allowProvisioningUpdates \
    2>&1 | tee "$UPLOAD_LOG"
)
EXPORT_RC=$?
set -e

if [[ $EXPORT_RC -ne 0 ]]; then
  if grep -qE "No Accounts|Failed to Use Accounts" "$UPLOAD_LOG"; then
    echo ""
    echo "Upload failed: Xcode không có account cho team $TEAM_ID."
    echo "Fallback: xuất IPA để upload thủ công qua Transporter..."
    (
      cd "$IOS_DIR"
      xcodebuild -exportArchive \
        -archivePath "$ARCHIVE_PATH" \
        -exportPath "$EXPORT_DIR" \
        -exportOptionsPlist "$EXPORT_OPTIONS_PLIST_IPA" \
        -allowProvisioningUpdates \
        2>&1 | tee -a "$UPLOAD_LOG"
    )
    IPA_PATH="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
    if [[ -n "$IPA_PATH" ]]; then
      echo ""
      echo "IPA exported: $IPA_PATH"
      echo "Mở Transporter (App Store) và kéo file IPA trên vào để upload TestFlight."
      echo "Hoặc login Xcode > Settings > Accounts rồi chạy lại: ./run-tf.sh --skip-pod-install"
    fi
  else
    echo "Export/upload failed. Xem log: $UPLOAD_LOG"
  fi
  exit $EXPORT_RC
fi

echo ""
echo "Done! Build đã upload lên TestFlight."
echo "Archive log: $ARCHIVE_LOG"
echo "Upload log:  $UPLOAD_LOG"
echo "Kiểm tra App Store Connect: build status sẽ chuyển sang 'Processing' rồi 'Ready to Test'."

#!/bin/bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20.19.6
cd /Users/ben/Documents/bk/cdn/builder-1/kara2/react-native-app
exec npx expo start --ios

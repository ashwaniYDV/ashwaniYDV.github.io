#!/bin/sh

echo "pull master"
git pull origin master

echo "npm run build"
npm run build

git add .
git commit -m "updates"

echo "push to github"
git push origin master
#!/bin/bash


# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install it from https://nodejs.org/"
    exit 1
fi

# Check if yarn is installed
if ! command -v yarn &> /dev/null; then
    echo "yarn is not installed. After installing Node.js, please install yarn from https://classic.yarnpkg.com/en/docs/install/"
    exit 1
fi

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "git is not installed. Please install it from https://git-scm.com/downloads"
    exit 1
fi

# Prompt user to update
read -p "Before running Omnitool, do you want to update the project from Github first? (y/n) " -n 1 -r
echo  # move to a new line

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Pull latest changes from git
    git pull
    if [ $? -ne 0 ]; then
        echo "Error occurred during git pull. Exiting."
        exit 1
    fi
fi

# Run yarn commands
yarn
yarn start -u -rb "$@"  # Pass all arguments to yarn start

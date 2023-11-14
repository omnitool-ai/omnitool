@echo off

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed. Please install it from https://nodejs.org/
    exit /b
)

:: Check if yarn is installed
where yarn >nul 2>&1
if %errorlevel% neq 0 (
    echo yarn is not installed. After installing Node.js, please install yarn from https://classic.yarnpkg.com/en/docs/install/
    exit /b
)

:: Check if git is installed
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo git is not installed. Please install it from https://git-scm.com/downloads
    exit /b
)

:: Prompt user to update
set /p update="Before running Omnitool, do you want to update the project from Github first? (y/n) "
if /I "%update%"=="y" (
    :: Pull latest changes from git
    git pull
    if %errorlevel% neq 0 (
        echo Error occurred during git pull. Exiting.
        exit /b
    )
)

:: Run yarn commands
call yarn
call yarn start -u -rb %*

# Makefile for SharedUtilsLayer
# This copies the shared utilities to the proper Lambda layer structure

build-SharedUtilsLayer:
	if not exist "$(ARTIFACTS_DIR)\nodejs" mkdir "$(ARTIFACTS_DIR)\nodejs"
	if not exist "$(ARTIFACTS_DIR)\nodejs\@" mkdir "$(ARTIFACTS_DIR)\nodejs\@"
	if not exist "$(ARTIFACTS_DIR)\nodejs\@\shared" mkdir "$(ARTIFACTS_DIR)\nodejs\@\shared"
	xcopy /E /I /Y auth "$(ARTIFACTS_DIR)\nodejs\@\shared\auth"
	xcopy /E /I /Y config "$(ARTIFACTS_DIR)\nodejs\@\shared\config"
	xcopy /E /I /Y identity "$(ARTIFACTS_DIR)\nodejs\@\shared\identity"
	xcopy /E /I /Y middlewares "$(ARTIFACTS_DIR)\nodejs\@\shared\middlewares"
	xcopy /E /I /Y notifications "$(ARTIFACTS_DIR)\nodejs\@\shared\notifications"
	xcopy /E /I /Y services "$(ARTIFACTS_DIR)\nodejs\@\shared\services"
	xcopy /E /I /Y storage "$(ARTIFACTS_DIR)\nodejs\@\shared\storage"
	xcopy /E /I /Y utils "$(ARTIFACTS_DIR)\nodejs\@\shared\utils"
	copy /Y package.json "$(ARTIFACTS_DIR)\nodejs\@\shared\"
	copy /Y response.js "$(ARTIFACTS_DIR)\nodejs\@\shared\"

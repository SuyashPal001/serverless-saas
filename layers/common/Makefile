# For Linux use this
# build-CommonDependenciesLayer:
# 	mkdir -p "`$(ARTIFACTS_DIR)/nodejs"`
# 	cp -r node_modules "$(ARTIFACTS_DIR)/nodejs/"
# 	cp package.json "`$(ARTIFACTS_DIR)/nodejs/"

# For Powershell use this in window

# build-CommonDependenciesLayer:
# 	cd nodejs && npm run build
# 	if not exist "$(ARTIFACTS_DIR)\nodejs\node_modules\@common" mkdir "$(ARTIFACTS_DIR)\nodejs\node_modules\@common"
# 	xcopy /E /I /Y nodejs\dist "$(ARTIFACTS_DIR)\nodejs\node_modules\@common"
# 	copy /Y package.json "$(ARTIFACTS_DIR)\nodejs\"


# build-CommonDependenciesLayer:
# 	if not exist "$(ARTIFACTS_DIR)\nodejs" mkdir "$(ARTIFACTS_DIR)\nodejs"
# 	xcopy /E /I /Y node_modules "$(ARTIFACTS_DIR)\nodejs\node_modules"
# 	copy /Y package.json "$(ARTIFACTS_DIR)\nodejs\package.json"
# 	copy /Y studioServiceAccountKey.json "$(ARTIFACTS_DIR)\nodejs\dist\studioServiceAccountKey.json"

#  This is lighter and safer makefile script
build-CommonDependenciesLayer:
	if exist "$(ARTIFACTS_DIR)\nodejs" rmdir /S /Q "$(ARTIFACTS_DIR)\nodejs"
	mkdir "$(ARTIFACTS_DIR)\nodejs"
	copy package.json "$(ARTIFACTS_DIR)\nodejs\package.json"
	npm install --production --prefix "$(ARTIFACTS_DIR)\nodejs"


# build-CommonDependenciesLayer:
# 	if not exist "$(ARTIFACTS_DIR)\nodejs" mkdir "$(ARTIFACTS_DIR)\nodejs"
# 	xcopy /E /I /Y node_modules "$(ARTIFACTS_DIR)\nodejs\node_modules"
# 	xcopy /E /I /Y shared "$(ARTIFACTS_DIR)\nodejs\shared"
# 	copy /Y package.json "$(ARTIFACTS_DIR)\nodejs\"

# use this to build sam, run from docker
# sam build --use-container
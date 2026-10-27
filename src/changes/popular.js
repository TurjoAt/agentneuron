// Small bundled lists of widely used package names per ecosystem, for look-alike (typosquat) checks.
// Hand-curated, offline; not exhaustive. A name on the list is treated as "known", not as "safe".
const words = (s) => s.split(/\s+/).filter(Boolean);

export const NPM = words(`
react react-dom react-router react-router-dom react-redux redux @reduxjs/toolkit next vue vue-router vuex pinia nuxt svelte @sveltejs/kit
angular @angular/core @angular/common @angular/router @angular/cli solid-js preact lit jquery lodash lodash-es underscore ramda moment dayjs
date-fns luxon axios node-fetch got superagent request ky express koa fastify hapi @hapi/hapi restify connect body-parser cookie-parser
cors helmet morgan compression multer express-session passport passport-local passport-jwt jsonwebtoken bcrypt bcryptjs argon2 jose
uuid nanoid shortid chalk kleur picocolors colors debug winston pino bunyan loglevel commander yargs minimist meow inquirer prompts ora
dotenv cross-env nodemon ts-node tsx typescript @types/node @types/react @types/express esbuild vite webpack webpack-cli rollup parcel
babel-loader @babel/core @babel/preset-env @babel/preset-react @babel/preset-typescript @babel/cli core-js regenerator-runtime
eslint prettier eslint-config-prettier eslint-plugin-react eslint-plugin-import @typescript-eslint/parser @typescript-eslint/eslint-plugin
jest mocha chai sinon vitest ava tap supertest nock cypress playwright @playwright/test puppeteer @testing-library/react
@testing-library/jest-dom @testing-library/user-event enzyme karma jasmine c8 nyc istanbul
mongoose mongodb mysql mysql2 pg pg-promise sqlite3 better-sqlite3 sequelize typeorm prisma @prisma/client knex redis ioredis
drizzle-orm drizzle-kit graphql apollo-server @apollo/client @apollo/server graphql-tag graphql-request urql socket.io socket.io-client
ws rxjs immer immutable zod yup joi ajv class-validator class-transformer reflect-metadata tslib rimraf mkdirp glob globby fast-glob
fs-extra graceful-fs chokidar micromatch minimatch semver qs query-string querystring url-parse path-to-regexp cheerio jsdom
marked markdown-it remark rehype unified highlight.js prismjs shiki handlebars ejs pug mustache nunjucks sharp jimp canvas
tailwindcss postcss autoprefixer sass less styled-components @emotion/react @emotion/styled classnames clsx framer-motion
three d3 chart.js recharts echarts leaflet mapbox-gl @mui/material @mui/icons-material antd bootstrap react-bootstrap
@headlessui/react @radix-ui/react-dialog lucide-react react-icons @fortawesome/fontawesome-svg-core react-hook-form formik
@tanstack/react-query react-query swr zustand jotai recoil mobx mobx-react xstate async bluebird p-limit p-queue p-map
lru-cache node-cache keyv cache-manager bull bullmq agenda node-cron cron nodemailer twilio stripe @stripe/stripe-js
aws-sdk @aws-sdk/client-s3 firebase firebase-admin @google-cloud/storage googleapis @sendgrid/mail openai @anthropic-ai/sdk
electron electron-builder react-native expo @react-navigation/native ionic @capacitor/core cordova
husky lint-staged @commitlint/cli standard-version semantic-release lerna nx turbo concurrently npm-run-all wait-on
http-proxy http-proxy-middleware serve serve-static live-server browser-sync open execa cross-spawn shelljs which
yaml js-yaml toml ini xml2js fast-xml-parser csv-parse papaparse xlsx pdfkit jspdf archiver adm-zip tar unzipper
form-data busboy formidable mime mime-types content-type iconv-lite buffer events util process stream-browserify
crypto-js node-forge tweetnacl bn.js ethers web3 big.js decimal.js bignumber.js numeral accounting validator
escape-html sanitize-html dompurify xss he entities html-entities string-width strip-ansi ansi-styles wrap-ansi
supports-color source-map source-map-support esprima acorn espree @babel/parser terser uglify-js clean-css cssnano
svgo html-webpack-plugin mini-css-extract-plugin css-loader style-loader file-loader url-loader ts-loader
storybook @storybook/react msw json-server faker @faker-js/faker chance lowdb nedb level
`);

export const PYPI = words(`
requests urllib3 certifi idna charset-normalizer httpx aiohttp httpcore h11 websockets websocket-client
numpy pandas scipy matplotlib seaborn plotly bokeh scikit-learn scikit-image statsmodels sympy networkx
tensorflow keras torch torchvision torchaudio jax transformers datasets tokenizers accelerate sentencepiece
openai anthropic langchain langchain-core llama-index tiktoken huggingface-hub safetensors xgboost lightgbm catboost
opencv-python pillow imageio django djangorestframework django-cors-headers django-environ celery kombu
flask flask-cors flask-sqlalchemy flask-login flask-wtf werkzeug jinja2 markupsafe itsdangerous click
fastapi starlette uvicorn gunicorn pydantic pydantic-core pydantic-settings sqlalchemy alembic psycopg2 psycopg2-binary
psycopg pymysql mysqlclient redis pymongo motor elasticsearch boto3 botocore s3transfer awscli google-cloud-storage
google-api-python-client google-auth azure-storage-blob azure-identity pytest pytest-cov pytest-asyncio pytest-mock
pytest-xdist coverage tox nox hypothesis mock faker factory-boy freezegun responses black isort flake8 pylint
mypy ruff autopep8 yapf bandit pre-commit setuptools wheel pip virtualenv pipenv poetry poetry-core hatchling
twine build packaging pyyaml toml tomli tomlkit python-dotenv attrs cattrs dataclasses-json marshmallow
typing-extensions six python-dateutil pytz tzdata arrow pendulum tqdm rich colorama termcolor tabulate
loguru structlog sentry-sdk prometheus-client cryptography pyjwt bcrypt passlib paramiko pyopenssl
pycryptodome rsa oauthlib requests-oauthlib authlib beautifulsoup4 lxml html5lib scrapy selenium playwright
pyppeteer mechanize feedparser markdown mistune docutils sphinx mkdocs mkdocs-material jsonschema
simplejson orjson ujson msgpack protobuf grpcio grpcio-tools pyarrow fastparquet h5py tables openpyxl
xlrd xlsxwriter python-docx reportlab pypdf pdfplumber filelock watchdog psutil docker kubernetes
ansible fabric invoke sh pexpect apscheduler schedule dramatiq rq gevent eventlet greenlet trio anyio
asyncpg aiofiles uvloop cachetools diskcache joblib dill cloudpickle numba cython pybind11 cffi
regex chardet unidecode python-slugify emoji nltk spacy gensim textblob streamlit gradio dash jupyter
notebook ipython ipykernel jupyterlab nbformat tornado pyzmq wrapt decorator deprecated more-itertools
`);

export const PACKAGIST = words(`
laravel/framework laravel/laravel laravel/sanctum laravel/passport laravel/tinker laravel/horizon laravel/telescope
laravel/sail laravel/breeze laravel/jetstream laravel/socialite laravel/cashier laravel/scout laravel/octane
laravel/pint laravel/dusk laravel/fortify laravel/prompts laravel/serializable-closure livewire/livewire
inertiajs/inertia-laravel spatie/laravel-permission spatie/laravel-medialibrary spatie/laravel-backup
spatie/laravel-activitylog spatie/laravel-query-builder spatie/laravel-data spatie/laravel-ignition
spatie/laravel-sluggable spatie/laravel-translatable barryvdh/laravel-debugbar barryvdh/laravel-dompdf
barryvdh/laravel-ide-helper maatwebsite/excel intervention/image league/flysystem league/flysystem-aws-s3-v3
league/csv league/oauth2-client league/oauth2-server league/commonmark league/fractal guzzlehttp/guzzle
guzzlehttp/psr7 guzzlehttp/promises symfony/console symfony/http-foundation symfony/http-kernel symfony/routing
symfony/yaml symfony/process symfony/finder symfony/filesystem symfony/event-dispatcher symfony/dependency-injection
symfony/var-dumper symfony/mailer symfony/framework-bundle symfony/security-bundle symfony/twig-bundle symfony/form
symfony/validator symfony/serializer symfony/cache symfony/dotenv symfony/flex symfony/maker-bundle symfony/orm-pack
doctrine/orm doctrine/dbal doctrine/migrations doctrine/doctrine-bundle doctrine/collections doctrine/annotations
doctrine/inflector monolog/monolog phpunit/phpunit mockery/mockery fakerphp/faker nunomaduro/collision
pestphp/pest phpstan/phpstan vimeo/psalm squizlabs/php_codesniffer friendsofphp/php-cs-fixer rector/rector
nesbot/carbon vlucas/phpdotenv ramsey/uuid firebase/php-jwt lcobucci/jwt tymon/jwt-auth paragonie/random_compat
predis/predis aws/aws-sdk-php google/apiclient stripe/stripe-php twilio/sdk phpmailer/phpmailer swiftmailer/swiftmailer
twig/twig smarty/smarty dompdf/dompdf tecnickcom/tcpdf mpdf/mpdf phpoffice/phpspreadsheet phpoffice/phpword
psr/log psr/container psr/http-message psr/http-client psr/cache psr/simple-cache psr/event-dispatcher
composer/composer composer/installers slim/slim slim/psr7 nikic/php-parser nikic/fast-route php-di/php-di
filament/filament filp/whoops sentry/sentry-laravel sentry/sentry pusher/pusher-php-server
egulias/email-validator respect/validation webmozart/assert brick/math moneyphp/money
`);

export const POPULAR = { npm: NPM, pypi: PYPI, packagist: PACKAGIST };
/** manager -> list key */
export const ECOSYSTEM = { npm: 'npm', pnpm: 'npm', yarn: 'npm', bun: 'npm', composer: 'packagist', pip: 'pypi', poetry: 'pypi' };
/** scopes whose packages are official forms of a popular unscoped name */
export const KNOWN_SCOPES = new Set(['@types', '@babel', '@angular', '@vue', '@sveltejs', '@reduxjs', '@testing-library', '@typescript-eslint', '@mui', '@emotion', '@tanstack',
  '@apollo', '@prisma', '@aws-sdk', '@google-cloud', '@stripe', '@playwright', '@storybook', '@nestjs', '@nuxt', '@vitejs', '@rollup', '@esbuild', '@swc', '@radix-ui', '@headlessui',
  '@fortawesome', '@hapi', '@octokit', '@sentry', '@vercel', '@commitlint', '@faker-js', '@react-navigation', '@capacitor', '@anthropic-ai', '@sendgrid', '@modelcontextprotocol', '@biomejs', '@changesets', '@eslint']);

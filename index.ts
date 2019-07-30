import * as bunyan from "bunyan";

export interface ILogContext {
  clearAll(): void;
  replaceAllWith(ctx: object): void;
  setContext(key: string, value: any): void;
  getContext(): object;
}

export interface ILogger {
  debug(msg: string, params: object): void;
  info(msg: string, params: object): void;
  warn(msg: string, params: object, error: object): void;
  error(msg: string, params: object, error: object): void;
  setContext(key: string, value: any): void;
}

export interface ILogFactory {
  createLogger(logName: string, customSerializers?: object): ILogger;
}

let CONTEXT: object = {};

export class LogContext implements ILogContext {
  public clearAll() {
    // Clear down context object
    CONTEXT = {};
  }
  public replaceAllWith(ctx) {
    // Replace context object
    CONTEXT = ctx;
  }
  public setContext(key, value) {
    // Set into context object
    if (!CONTEXT) {
      CONTEXT = {};
    }

    CONTEXT[key] = value;
  }
  public getContext() {
    // Get context object
    return CONTEXT || {};
  }
}

export class LogFactory implements ILogFactory {
  constructor(public context: ILogContext) {}

  public createLogger(logName: string, customSerializers?: object): ILogger {
    const outerContext = this.context;
    /* tslint:disable */
    const LogLevels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };
    /* tslint:enable */

    // most of these are available through the Node.js execution environment for Lambda
    // see https://docs.aws.amazon.com/lambda/latest/dg/current-supported-versions.html
    const DEFAULT_CONTEXT = {
      awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
      functionMemorySize: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
      stage: process.env.ENVIRONMENT || process.env.STAGE
    };

    function getContext() {
      const state = outerContext.getContext();
      if (state) {
        // note: this is a shallow copy, ok no mutation
        return Object.assign({}, DEFAULT_CONTEXT, state);
      }

      return DEFAULT_CONTEXT;
    }

    // default to debug if not specified
    function logLevelName() {
      return process.env.LOG_LEVEL || "DEBUG";
    }

    function isEnabled(level) {
      return level >= LogLevels[logLevelName()];
    }

    function appendError(params, err) {
      if (!err) {
        return params;
      }

      return Object.assign({}, params || {}, {
        errorMessage: err.message,
        errorName: err.name,
        stackTrace: err.stack
      });
    }

    // /--- Serializers

    const STANDARD_SERIALIZERS = {
      err: bunyan.stdSerializers.err,
      req: bunyan.stdSerializers.req,
      res: bunyan.stdSerializers.res
    };

    const SERIALIZERS = customSerializers
      ? Object.assign({}, STANDARD_SERIALIZERS, customSerializers)
      : STANDARD_SERIALIZERS;

    /**
     * Create a bunyan logger.
     */
    function createLogger(name) {
      return bunyan.createLogger({
        level: 10, // set at trace since wrapper logger has final say
        name,
        serializers: SERIALIZERS,
        stream: process.stdout
      });
    }

    const outerLogger = createLogger(logName);

    function log(levelName, message, params) {
      if (!isEnabled(LogLevels[levelName])) {
        return;
      }

      const context = getContext();
      const combinedParams = Object.assign({}, context, params);

      switch (levelName) {
        case "DEBUG":
          outerLogger.debug(combinedParams, message);
          break;
        case "INFO":
          outerLogger.info(combinedParams, message);
          break;
        case "WARN":
          outerLogger.warn(combinedParams, message);
          break;
        case "ERROR":
          outerLogger.error(combinedParams, message);
          break;
        default:
          outerLogger.warn(
            combinedParams,
            `Unrecognised log level ${levelName}`
          );
      }
    }

    return {
      debug(msg, params) {
        return log("DEBUG", msg, params);
      },
      info(msg, params) {
        return log("INFO", msg, params);
      },
      warn(msg, params, error) {
        return log("WARN", msg, appendError(params, error));
      },
      error(msg, params, error) {
        return log("ERROR", msg, appendError(params, error));
      },
      setContext(key, value) {
        outerContext.setContext(key, value);
      }
    };
  }
}

const logContext = new LogContext();
const logFactory: ILogFactory = new LogFactory(logContext);
export { logFactory };

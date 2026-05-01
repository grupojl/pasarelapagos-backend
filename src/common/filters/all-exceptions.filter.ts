import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx  = host.switchToHttp();
    const res  = ctx.getResponse();
    const req  = ctx.getRequest();
    const isProd = process.env.NODE_ENV === 'production';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const response =
      exception instanceof HttpException
        ? exception.getResponse()
        : null;

    // Log completo internamente (con stack)
    if (status >= 500) {
      this.logger.error(
        {
          err:    exception,
          path:   req.url,
          method: req.method,
          traceId: req.headers['x-trace-id'] ?? req.id,
        },
        'unhandled error',
      );
    }

    // Respuesta al cliente: sin stack en producción
    const clientMessage = isProd && status >= 500
      ? 'Error interno del servidor'
      : typeof response === 'string'
        ? response
        : (response as any)?.message ?? 'Error interno del servidor';

    res.status(status).json({
      statusCode: status,
      error:      clientMessage,
      // Solo incluir detalles en dev
      ...(isProd ? {} : {
        detail: typeof response === 'object' ? response : undefined,
      }),
      path:      req.url,
      timestamp: new Date().toISOString(),
      traceId:   req.headers['x-trace-id'] ?? req.id ?? undefined,
    });
  }
}

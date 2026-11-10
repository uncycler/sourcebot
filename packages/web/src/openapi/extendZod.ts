import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// With zod v4, `.openapi()` is only available on schemas created *after*
// `extendZodWithOpenApi` runs. This module must therefore be imported before
// any module that defines schemas used by the public OpenAPI document.
extendZodWithOpenApi(z);

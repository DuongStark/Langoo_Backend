---
name: nestjs-swagger-contract
description: >-
  Use this skill when developing, refactoring, or auditing NestJS controllers, services, DTOs, and OpenAPI/Swagger documentation in Langoo.
  Enforces strict input validation, response schema completeness, and consistent API contract patterns.
---

# NestJS & Swagger API Contract Guidelines

Langoo uses **NestJS 11**, TypeScript, `class-validator`, `class-transformer`, and `@nestjs/swagger`. Every endpoint must have complete schema coverage to support frontend client generation and contract audits.

---

## 1. Controller Standards

1. **Class Decorators:**
   - Always group endpoints with `@ApiTags('...')`.
   - Protect private endpoints with `@UseGuards(JwtAuthGuard)` and annotate with `@ApiBearerAuth()`.
2. **Method Decorators:**
   - Include `@ApiOperation({ summary: '...', description: '...' })`.
   - Explicitly annotate ALL success and error response types:
     ```typescript
     @ApiResponse({ status: 200, description: 'Success description', type: ResponseDto })
     @ApiResponse({ status: 400, description: 'Bad Request / Validation error' })
     @ApiResponse({ status: 401, description: 'Unauthorized' })
     @ApiResponse({ status: 404, description: 'Resource not found' })
     ```
3. **HTTP Methods & Status Codes:**
   - `POST` creating resources: `@HttpCode(HttpStatus.CREATED)` (201).
   - `POST` actions / mutations not creating a resource: `@HttpCode(HttpStatus.OK)` (200).
   - `GET` queries: 200.
   - `DELETE` removing resources: 200 (or 204 if empty).

---

## 2. DTO & Validation Standards

1. **Request DTOs:**
   - Every request field must have `@ApiProperty()` or `@ApiPropertyOptional()` with type, example, and description.
   - Apply appropriate `class-validator` rules (`@IsString()`, `@IsUUID()`, `@IsOptional()`, `@IsInt()`, `@Min()`, `@Max()`).
   - Use `@Type(() => SubDto)` for nested objects and `@ValidateNested({ each: true })` for arrays.
2. **Response DTOs:**
   - Never return raw database records directly. Use dedicated Response DTOs.
   - Ensure all response properties are annotated with `@ApiProperty()` so Swagger UI and client generators see the complete JSON schema.

---

## 3. Streaming & Non-Standard Responses

For SSE endpoints (e.g., `src/ai/chat`):
- Annotate with `@Sse()` and `@ApiResponse({ status: 200, description: 'Server-Sent Events text/event-stream' })`.
- Return an `Observable<MessageEvent>`.
- Handle errors gracefully before the stream starts vs after the first delta.

---

## 4. Verification Commands

Before concluding any controller or DTO change:
```bash
# Verify build & TypeScript compilation
npm run build

# Run unit tests
npm test

# Run linter
npm run lint
```

// Deliberately bounded OpenAPI presentation subset, not the full specification.
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const schema = { $ref: 'https://json-schema.org/draft/2020-12/schema' };
const ref = object({ $ref: { type: 'string', minLength: 1 }, summary: string, description: string }, ['$ref']);
const content = { type: 'object', minProperties: 1, additionalProperties: object({ schema }, ['schema']) };
const response = { anyOf: [ref, object({ description: string, content }, ['description'])] };
const parameter = { anyOf: [ref, object({
  name: { type: 'string', minLength: 1 }, in: { enum: ['query', 'header', 'path', 'cookie'] },
  description: string, required: { type: 'boolean' }, schema,
}, ['name', 'in', 'schema'])] };
const parameters = { type: 'array', items: parameter };
const operation = object({
  summary: string, description: string, operationId: string,
  tags: { type: 'array', items: string }, parameters,
  requestBody: { anyOf: [ref, object({ description: string, required: { type: 'boolean' }, content }, ['content'])] },
  responses: { type: 'object', minProperties: 1, patternProperties: { '^(?:default|[1-5][0-9]{2}|[1-5]XX)$': response }, additionalProperties: false },
}, ['responses']);
const pathItem = object({
  $ref: string, summary: string, description: string, parameters,
  ...Object.fromEntries(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].map(key => [key, operation])),
});
export const openApiSubset = {
  $id: 'urn:tandem:openapi-3.1-presentation-subset',
  ...object({
    openapi: { enum: ['3.1.0', '3.1.1'] },
    info: object({ title: { type: 'string', minLength: 1 }, version: { type: 'string', minLength: 1 }, summary: string, description: string }, ['title', 'version']),
    jsonSchemaDialect: { const: 'https://json-schema.org/draft/2020-12/schema' },
    paths: { type: 'object', patternProperties: { '^/': pathItem }, additionalProperties: false },
    components: object({ schemas: { type: 'object', additionalProperties: schema } }),
  }, ['openapi', 'jsonSchemaDialect', 'info', 'paths']),
};

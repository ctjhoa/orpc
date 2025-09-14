import type { INestApplication, MiddlewareConsumer, NestMiddleware } from '@nestjs/common'
import { Controller, Module } from '@nestjs/common'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { oc } from '@orpc/contract'
import { implement } from '@orpc/server'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Implement, ORPCModule } from '../src'

// 1. oRPC Contract
const testContract = {
  hello: oc.route({
    path: '/hello',
    method: 'POST',
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({ greeting: z.string() })),
}

const testDetailedContract = {
  hello: oc.route({
    path: '/hello',
    method: 'POST',
    outputStructure: 'detailed',
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({
      status: z.number(),
      result: z.object({ greeting: z.string() }),
    })),
}

// 2. A real controller for the 'raw' output test
@Controller()
class TestRawController {
  @Implement(testContract.hello)
  hello() {
    return implement(testContract.hello).handler(async ({ input }) => {
      // This handler ALWAYS returns the raw output shape
      return { greeting: `Hello, ${input.name}!` }
    })
  }
}

// 3. A separate controller for the 'detailed' output test
@Controller()
class TestDetailedController {
  @Implement(testContract.hello)
  hello() {
    return implement(testDetailedContract.hello).handler(async ({ input }) => {
      // This handler ALWAYS returns the detailed output shape
      return {
        status: 201, // Custom status to verify detailed output works
        result: { greeting: `Hello, ${input.name}!` },
      }
    })
  }
}

// 4. Custom Middleware (remains the same)
class CustomHeaderMiddleware implements NestMiddleware {
  use(req: any, res: any, next: (error?: any) => void) {
    res.setHeader('X-Custom-Middleware', 'hello')
    next()
  }
}

// 5. Test Modules for each controller
@Module({
  controllers: [TestRawController],
})
class TestRawModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}
@Module({
  controllers: [TestDetailedController],
})
class TestDetailedModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CustomHeaderMiddleware).forRoutes('*')
  }
}

describe('oRPC Nest Middleware Integration', () => {
  const testSuite = (
    adapterName: 'Express' | 'Fastify',
    adapter: () => ExpressAdapter | FastifyAdapter,
  ) => {
    describe(`with ${adapterName}`, () => {
      let app: INestApplication

      async function createApp(testModule: any, orpcModuleConfig: any) {
        const moduleFixture = await Test.createTestingModule({
          imports: [testModule, ORPCModule.forRoot(orpcModuleConfig)],
        }).compile()

        app = moduleFixture.createNestApplication(adapter())
        app.enableCors()
        await app.init()
        if (adapterName === 'Fastify') {
          await (app as any).getHttpAdapter().getInstance().ready()
        }
      }

      afterEach(async () => {
        await app?.close()
      })

      it('should apply NestJS middleware and CORS with outputStructure: \'raw\'', async () => {
        await createApp(TestRawModule, {})

        await request(app.getHttpServer())
          .post('/hello')
          .send({ name: 'world' })
          .expect(200)
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            expect(response.body).toEqual({ greeting: 'Hello, world!' })
          })
      })

      it('should apply NestJS middleware and CORS with outputStructure: \'detailed\'', async () => {
        await createApp(TestDetailedModule, { outputStructure: 'detailed' })

        await request(app.getHttpServer())
          .post('/hello')
          .send({ name: 'detailed-world' })
          .expect(201) // Assert the custom status code
          .expect('Access-Control-Allow-Origin', '*')
          .expect('X-Custom-Middleware', 'hello')
          .then((response) => {
            // Manually parse the response text instead of relying on response.body
            // expect('tto').toEqual(response.text)
            const body = JSON.parse(response.text)
            expect(body).toEqual({
              greeting: 'Hello, detailed-world!',
            })
          })
      })
    })
  }

  testSuite('Express', () => new ExpressAdapter())
  testSuite('Fastify', () => new FastifyAdapter())
})

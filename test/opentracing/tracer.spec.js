'use strict'

const opentracing = require('opentracing')
const SpanContext = require('../../src/opentracing/span_context')
const Reference = opentracing.Reference

describe('Tracer', () => {
  let Tracer
  let tracer
  let Span
  let span
  let PrioritySampler
  let prioritySampler
  let Writer
  let writer
  let Recorder
  let recorder
  let Sampler
  let sampler
  let spanContext
  let fields
  let carrier
  let TextMapPropagator
  let HttpPropagator
  let BinaryPropagator
  let propagator
  let config
  let log

  beforeEach(() => {
    fields = {}

    span = {}
    Span = sinon.stub().returns(span)

    prioritySampler = {
      sample: sinon.stub()
    }
    PrioritySampler = sinon.stub().returns(prioritySampler)

    writer = {
      flush: sinon.spy()
    }
    Writer = sinon.stub().returns(writer)

    recorder = {
      init: sinon.spy(),
      record: sinon.spy()
    }
    Recorder = sinon.stub().returns(recorder)

    sampler = {
      isSampled: sinon.stub().returns(true)
    }
    Sampler = sinon.stub().returns(sampler)

    spanContext = {}
    carrier = {}

    TextMapPropagator = sinon.stub()
    HttpPropagator = sinon.stub()
    BinaryPropagator = sinon.stub()
    propagator = {
      inject: sinon.stub(),
      extract: sinon.stub()
    }

    config = {
      service: 'service',
      url: 'http://test:7777',
      flushInterval: 2000,
      sampleRate: 0.5,
      logger: 'logger',
      tags: {},
      debug: false
    }

    log = {
      use: sinon.spy(),
      toggle: sinon.spy()
    }

    Tracer = proxyquire('../src/opentracing/tracer', {
      './span': Span,
      './span_context': SpanContext,
      '../priority_sampler': PrioritySampler,
      '../writer': Writer,
      '../recorder': Recorder,
      '../sampler': Sampler,
      './propagation/text_map': TextMapPropagator,
      './propagation/http': HttpPropagator,
      './propagation/binary': BinaryPropagator,
      '../log': log
    })
  })

  it('should support recording', () => {
    tracer = new Tracer(config)

    expect(Writer).to.have.been.called
    expect(Writer).to.have.been.calledWith(prioritySampler, config.url)
    expect(Recorder).to.have.been.calledWith(writer, config.flushInterval)
    expect(recorder.init).to.have.been.called
  })

  it('should support manual flushing', () => {
    tracer = new Tracer(config)
    tracer.flush()
    expect(writer.flush).to.have.been.called
  })

  it('should support sampling', () => {
    tracer = new Tracer(config)

    expect(Sampler).to.have.been.calledWith(config.sampleRate)
  })

  it('should support logging', () => {
    tracer = new Tracer(config)

    expect(log.use).to.have.been.calledWith(config.logger)
    expect(log.toggle).to.have.been.calledWith(config.debug)
  })

  describe('startSpan', () => {
    it('should start a span', () => {
      fields.tags = { foo: 'bar' }
      fields.startTime = 1234567890000000000

      tracer = new Tracer(config)
      const testSpan = tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWith(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent: null,
        tags: {
          'foo': 'bar',
          'service.name': 'service'
        },
        startTime: fields.startTime
      })

      expect(testSpan).to.equal(span)
    })

    it('should start a span that is the child of a span', () => {
      const parent = new SpanContext()

      fields.references = [
        new Reference(opentracing.REFERENCE_CHILD_OF, parent)
      ]

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent
      })
    })

    it('should start a span that follows from a span', () => {
      const parent = new SpanContext()

      fields.references = [
        new Reference(opentracing.REFERENCE_FOLLOWS_FROM, parent)
      ]

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent
      })
    })

    it('should ignore additional follow references', () => {
      const parent = new SpanContext()

      fields.references = [
        new Reference(opentracing.REFERENCE_FOLLOWS_FROM, parent),
        new Reference(opentracing.REFERENCE_FOLLOWS_FROM, new SpanContext())
      ]

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent
      })
    })

    it('should ignore unknown references', () => {
      const parent = new SpanContext()

      fields.references = [
        new Reference('test', parent)
      ]

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent: null
      })
    })

    it('should ignore references that are not references', () => {
      fields.references = [{}]

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent: null
      })
    })

    it('should ignore references to objects other than span contexts', () => {
      fields.references = [
        new Reference(opentracing.REFERENCE_CHILD_OF, {})
      ]

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        operationName: 'name',
        parent: null
      })
    })

    it('should merge default tracer tags with span tags', () => {
      config.tags = {
        'foo': 'tracer',
        'bar': 'tracer'
      }

      fields.tags = {
        'bar': 'span',
        'baz': 'span'
      }

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        tags: {
          'foo': 'tracer',
          'bar': 'span',
          'baz': 'span'
        }
      })
    })

    it('should add the env tag from the env option', () => {
      config.env = 'test'

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.calledWithMatch(tracer, recorder, sampler, prioritySampler, {
        tags: {
          'env': 'test'
        }
      })
    })

    it('should return a noop span when not sampled', () => {
      sampler.isSampled.returns(false)

      tracer = new Tracer(config)

      expect(tracer.startSpan('name', fields)).to.equal(tracer._noopSpan)
    })

    it('should return a noop span when the parent is not sampled', () => {
      tracer = new Tracer(config)

      const parent = tracer._noopSpan

      fields.references = [
        new Reference(opentracing.REFERENCE_CHILD_OF, parent)
      ]

      expect(tracer.startSpan('name', fields)).to.equal(tracer._noopSpan)
    })

    it('should always start a new span when the parent is sampled', () => {
      const parent = new SpanContext()

      fields.references = [
        new Reference(opentracing.REFERENCE_CHILD_OF, parent)
      ]

      sampler.isSampled.returns(false)

      tracer = new Tracer(config)
      tracer.startSpan('name', fields)

      expect(Span).to.have.been.called
    })
  })

  describe('inject', () => {
    it('should support text map format', () => {
      TextMapPropagator.returns(propagator)

      tracer = new Tracer(config)
      tracer.inject(spanContext, opentracing.FORMAT_TEXT_MAP, carrier)

      expect(propagator.inject).to.have.been.calledWith(spanContext, carrier)
    })

    it('should support http headers format', () => {
      HttpPropagator.returns(propagator)

      tracer = new Tracer(config)
      tracer.inject(spanContext, opentracing.FORMAT_HTTP_HEADERS, carrier)

      expect(propagator.inject).to.have.been.calledWith(spanContext, carrier)
    })

    it('should support binary format', () => {
      BinaryPropagator.returns(propagator)

      tracer = new Tracer(config)
      tracer.inject(spanContext, opentracing.FORMAT_BINARY, carrier)

      expect(propagator.inject).to.have.been.calledWith(spanContext, carrier)
    })

    it('should handle errors', () => {
      tracer = new Tracer(config)

      expect(() => tracer.inject()).not.to.throw()
    })

    it('should generate the sampling priority', () => {
      TextMapPropagator.returns(propagator)

      tracer = new Tracer(config)
      tracer.inject(spanContext, opentracing.FORMAT_TEXT_MAP, carrier)

      expect(prioritySampler.sample).to.have.been.calledWith(spanContext)
    })
  })

  describe('extract', () => {
    it('should support text map format', () => {
      TextMapPropagator.returns(propagator)
      propagator.extract.withArgs(carrier).returns('spanContext')

      tracer = new Tracer(config)
      const spanContext = tracer.extract(opentracing.FORMAT_TEXT_MAP, carrier)

      expect(spanContext).to.equal('spanContext')
    })

    it('should support http headers format', () => {
      HttpPropagator.returns(propagator)
      propagator.extract.withArgs(carrier).returns('spanContext')

      tracer = new Tracer(config)
      const spanContext = tracer.extract(opentracing.FORMAT_HTTP_HEADERS, carrier)

      expect(spanContext).to.equal('spanContext')
    })

    it('should support binary format', () => {
      BinaryPropagator.returns(propagator)
      propagator.extract.withArgs(carrier).returns('spanContext')

      tracer = new Tracer(config)
      const spanContext = tracer.extract(opentracing.FORMAT_BINARY, carrier)

      expect(spanContext).to.equal('spanContext')
    })

    it('should handle errors', () => {
      tracer = new Tracer(config)

      expect(() => tracer.extract()).not.to.throw()
    })
  })
})

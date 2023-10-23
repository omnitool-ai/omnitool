/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// Description: Service to connect to AMQP server

import { Service, type IServiceConfig, type ServiceManager } from 'omni-shared';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as Amqp from './RestConsumerService/MockMQ.js';

interface IAmqpServiceConfig extends IServiceConfig {
  endpoint: string;
  username: string;
  password: string;
  fixedQueue?: string;
  pinned_consumers?: Record<string, string>;
  exchanges: Array<{
    name: string;
    type: string;
    options: any;
  }>;
}

const TASK_PROTOCOL_VERSION = 'aardvark'; // A version 'string', change when you need to make a breaking change

class AmqpService extends Service {
  taskQueueConnection?: Amqp.Connection;
  taskQueueChannel?: Amqp.Channel;
  consumerTag?: NodeJS.Timeout;

  shardId: string;

  constructor(id: string, manager: ServiceManager, config: IAmqpServiceConfig) {
    config.endpoint = config.endpoint?.replace('{{username}}', config.username);
    config.endpoint = config.endpoint?.replace('{{password}}', config.password);

    super(id, manager, config || {});

    this.shardId = os.type + os.hostname(); // TODO: This will probably not be needed anymore when rete is task based. Right now, this is used to make sure requests get routed back to the omni server that created them.
  }

  // Never use this from the consumer side
  publish(exchange: string, routingKey: string | undefined, message: any) {
    routingKey = routingKey ?? `REST-${TASK_PROTOCOL_VERSION}.requests`;
    this.taskQueueChannel?.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
  }

  // Never use this from the consumer side
  async publishAwaitable(exchange: string, routingKey: string | undefined, message: any) {
    return await new Promise((resolve, reject) => {
      const config = this.config as IAmqpServiceConfig;
      const taskId = uuidv4().replace(/-/g, '');
      message.taskId = taskId;
      message.shardId = this.shardId;
      routingKey = routingKey || `REST-${TASK_PROTOCOL_VERSION}.requests`;

      // We support 2 types of queue pinning: A general override for the server and a per component override
      let fixedQueue = config.fixedQueue;
      const integration = `${message.integration.key}.${message.integration.operationId}`;
      if (config.pinned_consumers?.[integration]) {
        fixedQueue = config.pinned_consumers[integration];
        this.debug('Fixed queue overriden from pinned consumers: ' + fixedQueue + ' for routing key: ' + integration);
      }
      if (fixedQueue) {
        this.debug('Fixing queue to ' + fixedQueue);
        routingKey = routingKey + (fixedQueue || '');
      }

      function stringifyWithLimit(obj: any, limit = 100) {
        const jsonString = JSON.stringify(obj);
        if (jsonString.length < limit) {
          return jsonString;
        }
        return jsonString.substring(0, limit) + `... Plus ${jsonString.length - limit} more bytes`;
      }

      this.info(
        'publishing message to exchange: ' +
          exchange +
          ' with routing key: ' +
          routingKey +
          ' message: ' +
          stringifyWithLimit(message)
      );
      this.info('subscribing to event: ' + `${this.id}:result.${taskId}` + ' for task: ' + taskId);

      this.app.events.once(`amqp:result.${taskId}`).then((payload: any) => {
        this.verbose('got result for task: ' + taskId);

        if (payload.result) {
          resolve(payload.result);
        } else if (payload.error) {
          this.warn('got error from the rest consumer for task' + taskId + ' error: ' + payload.error);
          reject(payload.error);
        } else if (!payload.result) {
          this.warn('no result, no error:', payload);
          resolve({});
        }
      });

      this.taskQueueChannel?.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
    });
  }

  async load(): Promise<boolean> {
    const config = this.config as IAmqpServiceConfig;
    this.taskQueueConnection = await Amqp.connect(config.endpoint);

    this.success('Connection to AMQP Task server established');

    this.taskQueueChannel = await this.taskQueueConnection.createChannel();

    // this.resultsQueueChannel = await this.taskQueueConnection.createChannel()

    // Create topic exchanges
    for (const exchange of config.exchanges || []) {
      this.verbose('asserting exchange: ' + exchange.name);
      await this.taskQueueChannel.assertExchange(exchange.name, exchange.type, exchange.options);
    }

    // Create the results queue
    const queueName = this.id + '-' + TASK_PROTOCOL_VERSION + '-' + this.shardId + '-queue';
    const routingKey = `RESULTS-${TASK_PROTOCOL_VERSION}.${this.shardId}`;

    // Declare and bind the queue to the exchange with the specified routing key
    await this.taskQueueChannel.assertQueue(queueName);
    await this.taskQueueChannel.bindQueue(queueName, 'omni_tasks', routingKey);
    this.success('Results Queue created and bound to tasks exchange, waiting to consume messages');

    return true;
  }

  // Consume incoming messages on the results queue
  async resultsHandler(message: any): Promise<boolean> {
    const channel = this.taskQueueChannel as Amqp.Channel;
    const self = this;
    try {
      // Check if the message is valid
      if (!message?.content?.toString()) {
        throw new Error('Invalid message received');
      }

      // Parse the message payload as a JSON object
      const payload = JSON.parse(message.content.toString());

      // Validate all information is there to take action
      if (!payload?.taskId) {
        self.error('No message payload or task id missing, discarding', payload);

        throw new Error('Invalid message payload');
      }

      // Log the received payload
      self.verbose(`Received message for task ${payload.taskId}`);

      // Handle the result based on whether it's an error or a response object
      if (payload.error) {
        self.error('Task failed Failed to process message with error:', payload.error);

        // Signal the event and discard the message

        await self.app.emit('amqp:result.' + payload.taskId, payload);
        channel.ack(message);
      } else {
        try {
          // Signal the event and discard the message
          await self.app.emit('amqp:result.' + payload.taskId, payload);
          self.verbose(`Task ${payload.taskId} completed successfully`);
        } catch (error) {
          self.error(error);
        } finally {
          // TODO: If we throw in the emit, we need to work out a requeing strategy instead of just dropping the message
          channel.ack(message);
        }
        // Acknowledge the message to remove it from the queue
      }
    } catch (error: unknown) {
      // Log any unexpected errors to the console
      self.error(`Failed to process message with error: ${error}`);

      // Discard the message
      if (message) {
        channel.ack(message);
      }
    }
    return true;
  }

  async start(): Promise<boolean> {
    if (!this.taskQueueChannel) {
      throw new Error('unable to find the exchange');
    }

    await this.taskQueueChannel.purgeQueue(this.id + '-' + TASK_PROTOCOL_VERSION + '-' + this.shardId + '-queue');

    const queueName = this.id + '-' + TASK_PROTOCOL_VERSION + '-' + this.shardId + '-queue';
    this.info('Starting Queue Consumer', queueName);
    this.consumerTag = (await this.taskQueueChannel.consume(queueName, this.resultsHandler.bind(this))).consumerTag;

    return true;
  }

  async stop(): Promise<boolean> {
    if (this.consumerTag) {
      this.taskQueueChannel?.cancel(this.consumerTag);
      this.consumerTag = undefined;
    }

    return true;
  }
}

export { AmqpService, type IAmqpServiceConfig };

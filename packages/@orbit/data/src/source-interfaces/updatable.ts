import Orbit from '../main';
import { assert } from '@orbit/utils';
import { settleInSeries, fulfillInSeries } from '@orbit/core';
import { Operation } from '../operation';
import Transform, { TransformOrOperations } from '../transform';
import { Source, SourceClass } from '../source';

export const UPDATABLE = '__updatable__';

/**
 * Has a source been decorated as `@updatable`?
 * 
 * @export
 * @param {*} obj 
 * @returns 
 */
export function isUpdatable(source: Source) {
  return !!source[UPDATABLE];
}

/**
 * A source decorated as `@updatable` must also implement the `Updatable`
 * interface.
 *
 * @export
 * @interface Updatable
 */
export interface Updatable {
  /**
   * The `update` method accepts a `Transform` instance or an array of
   * operations which it then converts to a `Transform` instance. The source
   * applies the update and returns a promise that resolves when complete.
   *
   * @param {TransformOrOperations} transformOrOperations
   * @param {object} [options] 
   * @param {string} [id] 
   * @returns {Promise<void>}
   *
   * @memberOf Updatable
   */
  update(transformOrOperations: TransformOrOperations, options?: object, id?: string): Promise<void>;

  _update(transform: Transform): Promise<void>;
}

/**
 * Marks a source as "updatable" and adds an implementation of the `Updatable`
 * interface.
 *
 * The `update` method is part of the "request flow" in Orbit. Requests trigger
 * events before and after processing of each request. Observers can delay the
 * resolution of a request by returning a promise in an event listener.
 *
 * An updatable source emits the following events:
 *
 * - `beforeUpdate` - emitted prior to the processing of `update`, this event
 * includes the requested `Transform` as an argument.
 *
 * - `update` - emitted after an `update` has successfully been applied, this
 * event includes the requested `Transform` as an argument.
 *
 * - `updateFail` - emitted when an error has occurred applying an update, this
 * event's arguments include both the requested `Transform` and the error.
 *
 * An updatable source must implement a private method `_update`, which performs
 * the processing required for `update` and returns a promise that resolves when
 * complete.
 *
 * @export
 * @decorator
 * @param {SourceClass} Klass 
 * @returns {void}
 */
export default function updatable(Klass: SourceClass): void {
  let proto = Klass.prototype;

  if (isUpdatable(proto)) {
    return;
  }

  assert('Updatable interface can only be applied to a Source', proto instanceof Source);

  proto[UPDATABLE] = true;

  proto.update = function(transformOrOperations: TransformOrOperations, options?: object, id?: string): Promise<void> {
    const transform = Transform.from(transformOrOperations, options, id);

    if (this.transformLog.contains(transform.id)) {
      return Orbit.Promise.resolve([]);
    }

    return this._enqueueRequest('update', transform);
  }

  proto.__update__ = function(transform: Transform): Promise<void> {
    if (this.transformLog.contains(transform.id)) {
      return Orbit.Promise.resolve([]);
    }

    return fulfillInSeries(this, 'beforeUpdate', transform)
      .then(() => this._update(transform))
      .then(() => this._transformed([transform]))
      .then(() => settleInSeries(this, 'update', transform))
      .catch(error => {
        return settleInSeries(this, 'updateFail', transform, error)
          .then(() => { throw error; });
      });
  }
}

import superAgent from 'superagent';
import Promise from 'bluebird';
import _ from 'lodash';
import config from '../config';
import { camelizeKeys } from 'humps';

export const CALL_API = 'CALL_API';
export const CHAIN_API = 'CHAIN_API';

function actionWith(action, toMerge) {
  const ret = Object.assign({}, action, toMerge);
  delete ret[CALL_API];
  return ret;
}

function extractParams(callApi) {
  const {
    method,
    path,
    query,
    body,
    successType,
    errorType,
    afterSuccess,
    afterError,
  } = callApi;

  const url = `${config.API_BASE_URL}${path}`;

  return {
    method,
    url,
    query,
    body,
    successType,
    errorType,
    afterSuccess,
    afterError,
  };
}

function createRequestPromise(apiActionCreator, next, getState, dispatch) {
  return (prevBody) => {
    const apiAction = apiActionCreator(prevBody);
    const deferred = Promise.defer();
    const params = extractParams(apiAction[CALL_API]);

    superAgent[params.method](params.url)
      .send(params.body)
      .query(params.query)
      .end((err, res) => {
        if (err) {
          if (params.errorType) {
            dispatch(actionWith(apiAction, {
              type: params.errorType,
              error: err,
            }));
          }

          if (_.isFunction(params.afterError)) {
            params.afterError({ getState });
          }
          deferred.reject();
        } else {
          const resBody = camelizeKeys(res.body);
          dispatch(actionWith(apiAction, {
            type: params.successType,
            response: resBody,
          }));

          if (_.isFunction(params.afterSuccess)) {
            params.afterSuccess({ getState });
          }
          deferred.resolve(resBody);
        }
      });

    return deferred.promise;
  };
}

export default ({ dispatch, getState }) => next => action => {
  if (action[CALL_API]) {
    return dispatch({
      [CHAIN_API]: [
        () => action,
      ],
    });
  }

  const deferred = Promise.defer();

  if (! action[CHAIN_API]) {
    return next(action);
  }

  const promiseCreators = action[CHAIN_API].map((apiActionCreator) => {
    return createRequestPromise(apiActionCreator, next, getState, dispatch);
  });

  const overall = promiseCreators.reduce((promise, creator) => {
    return promise.then((body) => {
      return creator(body);
    });
  }, Promise.resolve());

  overall.finally(()=> {
    deferred.resolve();
  }).catch(()=> {});

  return deferred.promise;
}


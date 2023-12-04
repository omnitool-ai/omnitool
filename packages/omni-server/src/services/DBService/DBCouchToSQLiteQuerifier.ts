// @ts-nocheck AUTOGEN
/* eslint-disable */
import { MangoQuery } from 'nano';

class DBCouchToSQLiteQuerifier {
  private static operatorMap = {
    $eq: '=',
    $ne: '!=',
    $gt: '>',
    $gte: '>=',
    $lt: '<',
    $lte: '<=',
    $in: 'IN',
    $nin: 'NOT IN',
    $exists: 'IS NOT NULL',
    $elemMatch: 'LIKE' // Using LIKE for $elemMatch
  };

  public static translateQuery(mangoQuery: MangoQuery): string {
    let translatedQuery = 'SELECT * FROM kvstore WHERE ';

    for (let field in mangoQuery.selector) {
      let operand = mangoQuery.selector[field];
      translatedQuery += DBCouchToSQLiteQuerifier.translateCondition(field, operand);
    }

    return translatedQuery.slice(0, -5); // Remove the trailing ' AND '
  }

  private static translateCondition(field: string, operand: any, parentField?: string): string {
    let translatedCondition = '';

    if (Array.isArray(operand) && (field === '$or' || field === '$and')) {
      let operator = DBCouchToSQLiteQuerifier.operatorMap[field];
      let translatedConditions = operand.map((condition) => {
        let subQuery = DBCouchToSQLiteQuerifier.translateQuery({ selector: condition });
        return `(${subQuery.substring('SELECT * FROM kvstore WHERE '.length)})`;
      });
      translatedCondition += `(${translatedConditions.join(` ${operator} `)}) AND `;
    } else if (typeof operand === 'object' && operand !== null) {
      const isOperatorObject = Object.keys(operand).some((key) =>
        DBCouchToSQLiteQuerifier.operatorMap.hasOwnProperty(key)
      );
      if (isOperatorObject) {
        for (let operator in operand) {
          if (operator === '$exists') {
            let existsCheck = operand[operator] ? 'IS NOT NULL' : 'IS NULL';
            let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
            translatedCondition += `json_extract(value, ${jsonFieldPath}) ${existsCheck} AND `;
          } else if (operator === '$elemMatch') {
            let translatedOperator = DBCouchToSQLiteQuerifier.translateOperator(operator);
            // Handling $elemMatch for string pattern matching in JSON
            let subField = Object.keys(operand[operator])[0];
            let subValue = operand[operator][subField];
            let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
            translatedCondition += `json_extract(value, ${jsonFieldPath}) ${translatedOperator} '%${subValue}%' AND `;
          } else {
            let translatedOperator = DBCouchToSQLiteQuerifier.translateOperator(operator);
            let value = typeof operand[operator] === 'boolean' ? operand[operator] : `'${operand[operator]}'`;
            let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
            translatedCondition += `json_extract(value, ${jsonFieldPath}) ${translatedOperator} ${value} AND `;
          }
        }
      } else {
        // Handling nested fields as sub-conditions
        for (let subField in operand) {
          let fullFieldPath = parentField ? `${parentField}.${field}` : field;
          translatedCondition += DBCouchToSQLiteQuerifier.translateCondition(
            subField,
            operand[subField],
            fullFieldPath
          );
        }
      }
    } else {
      let translatedOperator = DBCouchToSQLiteQuerifier.translateOperator('$eq');
      let jsonFieldPath = parentField ? `'$.${parentField}.${field}'` : `'$.${field}'`;
      let value = typeof operand === 'boolean' ? operand : `'${operand}'`;
      translatedCondition += `json_extract(value, ${jsonFieldPath}) ${translatedOperator} ${value} AND `;
    }

    return translatedCondition;
  }

  private static translateOperator(mangoOperator: string): string {
    let translatedOperator = DBCouchToSQLiteQuerifier.operatorMap[mangoOperator];
    if (!translatedOperator) {
      throw new Error(`Unrecognized or unsupported operator: ${mangoOperator}`);
    }
    return translatedOperator;
  }
}

export { DBCouchToSQLiteQuerifier };

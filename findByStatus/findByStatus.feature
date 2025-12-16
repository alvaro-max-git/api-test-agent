Feature: Retrieve pets by status
  As a Petstore API consumer
  I want to retrieve pets filtered by status
  So I can validate responses for valid, missing, and invalid status values

  Background:
    Given I have the base URL "{{baseUrl}}"
    And the endpoint "/pet/findByStatus" accepts the query parameter "status" as a multi-value list
    And the endpoint does not require authentication

  Scenario Outline: Successful lookup with valid single status
    When I send a GET request to "{{baseUrl}}/pet/findByStatus" with status "<status>"
    Then the response status code should be 200
    And the header "Content-Type" should include "application/json"
    And the body should be a JSON array
    And the array should contain at least one pet with a status of "<status>"

    Examples:
      | status    |
      | available |
      | pending   |
      | sold      |

  Scenario: Lookup with multiple statuses
    When I send a GET request to "{{baseUrl}}/pet/findByStatus" with status "available" and "pending"
    Then the response status code should be 200
    And the header "Content-Type" should include "application/json"
    And the body should be a JSON array
    And the array should contain pets whose status is either "available" or "pending"

  Scenario: Missing status parameter returns empty list
    When I send a GET request to "{{baseUrl}}/pet/findByStatus" without query parameters
    Then the response status code should be 200
    And the body should be a JSON array with length 0

  Scenario: Invalid status value
    When I send a GET request to "{{baseUrl}}/pet/findByStatus" with status "unknown"
    Then the response status code should be 400
    And the header "Content-Type" should include "application/json"

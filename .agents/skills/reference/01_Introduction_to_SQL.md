# Introduction to SQL

**Source PDF:** `CS3042 - Introduction to SQL.pdf`

> Codex-ready text conversion of the supplied lecture PDF. Page boundaries are preserved.
> The wording is kept as close as possible to the source extraction. Content that exists only
> inside figures/screenshots may not be fully represented in this text conversion.

**Total pages:** 31

---

## Page 1

```text
Introduction to SQL
CS3042 - Database Systems

Dr Gayashan Amarasinghe
                            Department of Computer Science and Engineering
                                                     University of Moratuwa
```

## Page 2

```text
Overview
●   Brief History
●   SQL as a language
●   Data Types in SQL
●   CREATE TABLE construct and Integrity Constraints
●   DROP and ALTER TABLE constructs
●   SELECT clause
●   WHERE clause
●   FROM clause
●   Joins
●   Natural join
●   Rename operation
●   Ordering the results                               Database System Concepts 6th Edition
●   String operations                                  by Abraham Silberschatz, Henry F. Korth,
●   Aggregate functions                                and S. Sudarshan
●   Nested Subqueries                                                                             2
```

## Page 3

```text
History
●   IBM Sequel language developed as part of System R project at the IBM San
    Jose Research Laboratory
●   Renamed Structured Query Language (SQL)
●   ANSI and ISO standard SQL:
     ○ SQL-86, SQL-89, SQL-92
     ○ SQL:1999, SQL:2003, SQL:2008
●   Commercial systems oﬀer most, if not all, SQL-92 features, plus varying feature
    sets from later standards and special proprietary features.
●   Not all examples here may work on your particular system.

                    Structured Query Language
                                                                                      3
```

## Page 4

```text
SQL is a...
●   Very high level language
     ○ Works well because it is optimized well.
●   Data Deﬁnition Language

         CREATE TABLE

         DROP TABLE

●   Data Manipulation Language

         SELECT

         INSERT

         DELETE

         UPDATE                                   4
```

## Page 5

```text
Data types in SQL
●   char(n). Fixed length character string, with user-speciﬁed length n.
●   varchar(n). Variable length character strings, with user-speciﬁed maximum
    length n.
●   int. Integer (a ﬁnite subset of the integers that is machine dependent).
●   smallint. Small integer (a machine-dependent subset of the integer domain
    type).
●   numeric(p,d). Fixed point number, with user-speciﬁed precision of p digits, with
    d digits to the right of decimal point.
●   real, double precision. Floating point and double-precision ﬂoating point
    numbers, with machine-dependent precision.
●   ﬂoat(n). Floating point number, with user-speciﬁed precision of at least n digits.
                                                                                         5
```

## Page 6

```text
CREATE TABLE construct
●   An sql relation is deﬁned using CREATE TABLE construct

    CREATE TABLE r(A1 D1, A2 D2, ..., An Dn,
                                                                   r - name of the relation
                                                                   Ai - Attribute name in the schema of the
                              (integrity-constraint1),
                                                                   relation
                                                                   Di - Data type of values in the domain of
                              ...,
                                                                   attribute Ai
                              (integrity-constraintk))

    Eg:

    CREATE TABLE instructor (
                                            ID char(5),
                                            name varchar(20) not null,
                                            dept_name varchar(20),
                                            salary numeric(8,2))                                               6
```

## Page 7

```text
Integrity constraints in CREATE TABLE
●   not null
●   primary key (A1, A2,..., An)
●   foreign key (Am,..., An) references r

    Eg: Declare ID as the primary key for the instructor table.

          create table instructor (
                      ID char(5),
                      name varchar(20) not null,
                      dept_name varchar(20),
                      salary numeric(8,2),
                      primary key (ID),
                      foreign key (dept_name)
                                    references department(dept_name))

●   primary key declaration on an attribute automatically ensures not null   7
```

## Page 8

```text
DROP and ALTER TABLE constructs
●   DROP TABLE student
     ○ Deletes the table and its content
●   DELETE FROM student
     ○ Deletes all the content of the table, but retains the table
●   ALTER TABLE
     ○ ALTER TABLE r ADD A D
        ■ where A is the name of the attribute to be added to relation r and D is the
            domain/data type of A.
        ■ All tuples in the relation are assigned null as the value for the new
            attribute.
     ○ ALTER TABLE r DROP A
        ■ where A is the name of an attribute in relation r.
                                                                                        8
        ■ Many databases do not support this functionality.
```

## Page 9

```text
Basic Query Structure
●   SQL is also a Data Manipulation language
●   A typical SQL query has the form

        SELECT A1,A2,...,An
        FROM r1,r2,...,rm
        WHERE P

    ●   Ai represents an attribute
    ●   rj represents a relation
    ●   P is a predicate

●   The result of a query is another relation
                                                9
```

## Page 10

```text
SELECT clause
●   The SELECT clause list the attributes desired in the result of a query
     ○ corresponds to the projection operation of the relational algebra
●   Eg: Find the names of all the departments with instructors

         SELECT dept_name                 SQL names are case insensitive.
         FROM instructor                    name ≡ Name ≡ NAME


●   To force the elimination of duplicates, insert the keyword DISTINCT after SELECT.
●   Eg:

         SELECT DISTINCT dept_name
         FROM instructor
                                                                                        10
```

## Page 11

```text
SELECT clause
●   An asterisk in the SELECT clause denotes “all attributes”

    Eg:

          SELECT * FROM instructor

●   The SELECT clause can contain arithmetic expressions involving the operation, +, –, , and /, and
    operating on constants or attributes of tuples.

    Eg:

          SELECT ID, name, salary/12
          FROM instructor

    would return a relation that is the same as the instructor relation, except that the value of the attribute
    salary is divided by 12.                                                                                      11
```

## Page 12

```text
WHERE clause
●   WHERE clause speciﬁes conditions that the result must satisfy
     ○ Corresponds to the selection predicate of the relational algebra.
●   To ﬁnd all instructors in Comp. Sci. dept with salary > 80000

        SELECT name
        FROM instructor
        WHERE dept_name = ‘Comp. Sci.' AND salary > 80000

●   Comparison results can be combined using the logical connectives and, or,
    and not.
●   Comparisons can be applied to results of arithmetic expressions.

                                                                                12
```

## Page 13

```text
FROM clause
●   FROM clause lists the relations involved in the query
     ○ Corresponds to the Cartesian product operation of the relational algebra.
●   Find the Cartesian product instructor X teaches

        SELECT *
        FROM instructor, teaches

    ●   generates every possible instructor – teaches pair, with all attributes from
        both relations
●   Cartesian product is not very useful directly, but useful combined with
    where-clause condition (selection operation in relational algebra)

                                                                                       13
```

## Page 14

```text
Joins
●   For all instructors who have taught some course, ﬁnd their names and the course ID of
    the courses they taught.
                                                           Cartesian product of instructor
         SELECT name, course_id
                                                           relation and teaches relation
         FROM instructor, teaches
                                                                instructor x teaches
         WHERE instructor.ID = teaches.ID

●   Find the course ID, semester, year and title of each course oﬀered by the Comp. Sci.
    department

         SELECT section.course_id, semester, year, title
         FROM section, course
         WHERE section.course_id = course.course_id
                 AND dept_name = ‘Comp. Sci.'                                                14
```

## Page 15

```text
Writing some queries




                       15
```

## Page 16

```text
Natural Join
●   NATURAL JOIN matches tuples with the same values for all common
    attributes, and retains only one copy of each common column.

        SELECT *
        FROM instructor NATURAL JOIN teaches




                                                                      16
```

## Page 17

```text
Natural Join example
●   List the names of instructors along with the course ID of the courses that they
    taught.
     ○ Without NATURAL JOIN

             SELECT name, course_id
             FROM instructor, teaches
             WHERE instructor.id = teaches.id

    ○   With NATURAL JOIN

             SELECT name, course_id
             FROM instructor NATURAL JOIN teaches
                                                                                      17
```

## Page 18

```text
Be cautious with Natural Join
●   Dangers in NATURAL JOIN
      ○ beware of unrelated attributes with same name which get equated incorrectly
●   List the names of instructors along with the the titles of courses that they teach
      ○ Incorrect version (makes course.dept_name = instructor.dept_name)

          SELECT name, title
          FROM instructor NATURAL JOIN teaches NATURAL JOIN course

     ●    Correct version

          SELECT name, title
          FROM instructor NATURAL JOIN teaches, course
          WHERE teaches.course_id = course.course_id

     ●    Another correct version

          SELECT name, title
                                                                                         18
          FROM (instructor NATURAL JOIN teaches) JOIN course USING(course_id)
```

## Page 19

```text
Rename operation
●   SQL allows renaming relations and attributes using the AS clause

         SELECT ID, name, salary/12 AS monthly_salary
         FROM instructor

●   Find the names of all instructors who have a higher salary than some instructor in ‘Comp. Sci’.

         SELECT DISTINCT T. name
         FROM instructor AS T, instructor AS S
         WHERE T.salary > S.salary AND S.dept_name = ‘Comp. Sci.’

●   Keyword AS is optional and can be ommitted.

         SELECT ID, name, salary/12 monthly_salary
         FROM instructor                                                                              19
```

## Page 20

```text
Ordering the results
●   List in alphabetic order the names of all instructors

         SELECT DISTINCT name                               Ascending order is the
         FROM instructor                                    default.
         ORDER BY name

●   We may specify DESC for descending order or ASC for ascending order, for each
    attribute.

         Example: ORDER BY name DESC

●   Can sort on multiple attributes

         Example: ORDER BY dept_name, name
                                                                                     20
```

## Page 21

```text
String operations
●   LIKE operator can be used for string matching

        SELECT name                            % matches any substring
                                               _ matches any character
        FROM instructor                        \ escape character for % or _
        WHERE name LIKE “%dar%”

●   Patterns are case sensitive
●   SQL supports a variety of string operations such as
     ○ concatenation (using “||”)
     ○ converting from upper to lowercase (and vice versa)
     ○ ﬁnding string length, extracting substrings, etc.


                                                                               21
```

## Page 22

```text
WHERE clause predicates
●   SQL includes a BETWEEN comparison operator

        Example: Find the names of all instructors with salary between $90,000 and
        $100,000 (that is, $90,000 and $100,000)

             SELECT name
             FROM instructor
             WHERE salary BETWEEN 90000 AND 100000

●   Tuple comparison

             SELECT name, course_id
             FROM instructor, teaches
             WHERE (instructor.ID, dept_name) = (teaches.ID, ‘Biology’)
                                                                                     22
```

## Page 23

```text
Aggregate functions
●   These functions operate on the multiset of values of a column of a relation, and return a
    value
     ○ AVG: average value
     ○ MIN: minimum value
     ○ MAX: maximum value
     ○ SUM: sum of values
     ○ COUNT: number of values

●   Find the average salary of instructors in the Computer Science department

              SELECT AVG(salary)
              FROM instructor
              WHERE dept_name = ‘Comp. Sci.’;
                                                                                                23
```

## Page 24

```text
Aggregate functions
●   Find the total number of instructors who teach a course in the Spring 2010
    semester
              SELECT COUNT (DISTINCT ID)
              FROM teaches
              WHERE semester = ’Spring’ AND year = 2010



●   Find the number of tuples in the course relation
             SELECT COUNT (*)
             FROM course;
                                                                                 24
```

## Page 25

```text
Aggregate functions - GROUP BY clause
●   Find the average salary of instructors in each department

             SELECT dept_name, AVG(salary)
             FROM instructor
             GROUP BY dept_name

●   Attributes in SELECT clause outside of aggregate functions must appear in
    GROUP BY list

             /* erroneous query */
             SELECT dept_name, ID, AVG(salary)
             FROM instructor
             GROUP BY dept_name                                                 25
```

## Page 26

```text
Aggregate functions - HAVING clause
●   Find the names and average salaries of all departments whose average salary
    is greater than 42000

            SELECT dept_name, AVG(salary)
            FROM instructor
            GROUP BY dept_name
            HAVING AVG(salary) > 42000

              Predicates in the HAVING clause are applied after
              the formation of groups whereas predicates in the
              WHERE clause are applied before forming groups.

                                                                                  26
```

## Page 27

```text
Aggregate functions - NULL values
●   All aggregate operations except COUNT(*) ignore tuples with null values on the aggregated
    attributes
●   What if collection has only null values?
     ○ count returns 0
     ○ all other aggregates return null



    Eg: Total salary of all the instructors

                SELECT SUM(salary)
                FROM instructor

           ●    this statement ignores null values
           ●    result becomes null, if there are only null values in salary column.            27
```

## Page 28

```text
Nested subqueries
●   SQL provides a mechanism for the nesting of subqueries.
●   A subquery is a select-from-where expression that is nested within another query.
●   A common use of subqueries is to perform tests for set membership, set comparisons, and set
    cardinality.




    Eg: Find courses oﬀered in Fall 2009 and in Spring 2010

               SELECT DISTINCT course_id
               FROM section
               WHERE semester = ’Fall’ AND year= 2009 AND
                         course_id IN (SELECT course_id
                                               FROM section
                                               WHERE semester = ’Spring’
                                                                                                  28
                                                         AND year= 2010)
```

## Page 29

```text
Nested subqueries
Find courses oﬀered in Fall 2009 but not in Spring 2010

           SELECT DISTINCT course_id
           FROM section
           WHERE semester = ’Fall’ AND year= 2009 AND
                  course_id NOT IN (SELECT course_id
                                        FROM section
                                        WHERE semester = ’Spring’
                                                AND year= 2010)



                                                                    29
```

## Page 30

```text
Thank you!



             30
```

## Page 31

```text
Practice task
Employee(emp_no, emp_name, emp_city, …….)

Assignment(proj_no, emp_no, hours,……….)

Project(proj_name, budget, proj_no, proj_start_date, proj_end_date,
proj_location,……..)

Express each of the following queries in SQL statements:

1.   List the name(s) and budget(s) of projects started before 1st May 2008.
2.   List the name(s) of projects with a budget value above Rs. 1,000,000.
3.   Find the name(s) of employees who are from city “Moratuwa”.
4.   Find the name(s) of employees who are from city “Moratuwa” and work on projects located in
     “Moratuwa”.
5.   Find the name(s) of employees who work on projects valued above Rs. 1,000,000.               31
```
